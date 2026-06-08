// node imports
import Fs from 'node:fs';
import Path from 'node:path';

// npm imports
import Chalk from 'chalk';

// local imports
import { SessionLogEntry, SessionLogUserInput } from '../session/session_log_types';
import { SkilletPaths } from '../libs/skillet_paths';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	`log stream` — print existing user_message and final_result entries from all
//	session JSONL files under outputs/.agent_session_logs, then keep tailing
//	the directory for new appends and new files.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

type StreamOptions = {
	logsDirPath: string | undefined;
};

type FileState = {
	offset: number;
	pending: Promise<void>;
};

export class CliLogHelper {

	static async stream(options: StreamOptions): Promise<void> {
		const rootDir = CliLogHelper._resolveLogsDir(options.logsDirPath);

		let dirExists = true;
		try {
			const stat = await Fs.promises.stat(rootDir);
			if (stat.isDirectory() === false) {
				console.error(`[${Chalk.red('log stream')}] path is not a directory: ${rootDir}`);
				process.exitCode = 1;
				return;
			}
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				dirExists = false;
			} else {
				throw error;
			}
		}

		console.log(`[${Chalk.cyan('log stream')}] streaming session logs from ${Chalk.gray(rootDir)}`);

		if (dirExists === false) {
			console.log(`[${Chalk.cyan('log stream')}] directory does not exist yet — waiting for first session.`);
			console.log(`[${Chalk.cyan('log stream')}] press Ctrl-C to exit.`);
			return;
		}

		const fileStates = new Map<string, FileState>();
		const printerState = { lastFilePath: null as string | null };

		const existingFiles = await CliLogHelper._discoverJsonlFiles(rootDir);
		const filesWithMtime: { filePath: string; mtimeMs: number }[] = [];
		for (const filePath of existingFiles) {
			try {
				const stat = await Fs.promises.stat(filePath);
				filesWithMtime.push({ filePath, mtimeMs: stat.mtimeMs });
			} catch {
				// file disappeared between listing and stat — skip
			}
		}
		filesWithMtime.sort((a, b) => a.mtimeMs - b.mtimeMs);

		for (const { filePath } of filesWithMtime) {
			const state: FileState = { offset: 0, pending: Promise.resolve() };
			fileStates.set(filePath, state);
			state.pending = CliLogHelper._drainFile(filePath, state, rootDir, printerState);
			await state.pending;
		}

		const watcher = Fs.watch(rootDir, { recursive: true }, (_eventType, eventFilename) => {
			if (eventFilename === null || eventFilename === undefined) return;
			if (eventFilename.endsWith('.jsonl') === false) return;
			const filePath = Path.resolve(rootDir, eventFilename);
			let state = fileStates.get(filePath);
			if (state === undefined) {
				state = { offset: 0, pending: Promise.resolve() };
				fileStates.set(filePath, state);
			}
			const current = state;
			current.pending = current.pending.then(() => CliLogHelper._drainFile(filePath, current, rootDir, printerState));
		});

		const onSignal = () => {
			watcher.close();
			console.log(`\n[${Chalk.cyan('log stream')}] stopped.`);
			process.exit(0);
		};
		process.on('SIGINT', onSignal);
		process.on('SIGTERM', onSignal);

		console.log(`[${Chalk.cyan('log stream')}] tailing for new entries — press Ctrl-C to exit.`);

		// keep the event loop alive until a signal arrives
		await new Promise<void>(() => { /* never resolves */ });
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Private
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static _resolveLogsDir(optsPath: string | undefined): string {
		if (optsPath !== undefined && optsPath !== '') {
			return Path.resolve(optsPath);
		}
		// Anchor at the shared data dir (SKILLET_DATA_DIR ?? package outputs), not
		// the caller's cwd — so streaming logs works no matter where it's invoked.
		return SkilletPaths.agentSessionLogsDir();
	}

	private static async _discoverJsonlFiles(rootDir: string): Promise<string[]> {
		const result: string[] = [];
		let entries: Fs.Dirent[];
		try {
			entries = await Fs.promises.readdir(rootDir, { withFileTypes: true, recursive: true });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') return result;
			throw error;
		}
		for (const entry of entries) {
			if (entry.isFile() === false) continue;
			if (entry.name.endsWith('.jsonl') === false) continue;
			const parentPath = (entry as Fs.Dirent & { parentPath?: string; path?: string }).parentPath
				?? (entry as Fs.Dirent & { parentPath?: string; path?: string }).path
				?? rootDir;
			result.push(Path.resolve(parentPath, entry.name));
		}
		return result;
	}

	private static async _drainFile(
		filePath: string,
		state: FileState,
		rootDir: string,
		printerState: { lastFilePath: string | null },
	): Promise<void> {
		let stat: Fs.Stats;
		try {
			stat = await Fs.promises.stat(filePath);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') return;
			throw error;
		}
		if (stat.isFile() === false) return;
		if (stat.size <= state.offset) return;

		const fd = await Fs.promises.open(filePath, 'r');
		try {
			const length = stat.size - state.offset;
			const buffer = Buffer.allocUnsafe(length);
			await fd.read(buffer, 0, length, state.offset);
			const chunk = buffer.toString('utf8');
			const lines = chunk.split('\n');
			// the last segment may be a partial line if the writer is mid-append.
			// only consume up to the last newline so a torn tail is retried next event.
			const completeLines = lines.slice(0, -1);
			const trailing = lines[lines.length - 1];
			const consumedBytes = Buffer.byteLength(chunk.slice(0, chunk.length - trailing.length), 'utf8');
			state.offset += consumedBytes;

			for (const line of completeLines) {
				const trimmed = line.trim();
				if (trimmed === '') continue;
				let entry: SessionLogEntry;
				try {
					entry = JSON.parse(trimmed) as SessionLogEntry;
				} catch {
					continue;
				}
				if (entry.kind !== 'user_message' && entry.kind !== 'final_result') continue;
				CliLogHelper._printEntry(entry, filePath, rootDir, printerState);
			}
		} finally {
			await fd.close();
		}
	}

	private static _printEntry(
		entry: SessionLogEntry,
		filePath: string,
		rootDir: string,
		printerState: { lastFilePath: string | null },
	): void {
		if (printerState.lastFilePath !== filePath) {
			const label = CliLogHelper._relSessionLabel(filePath, rootDir);
			console.log(Chalk.dim.underline(`── ${label} ──`));
			printerState.lastFilePath = filePath;
		}

		if (entry.kind === 'user_message') {
			const text = CliLogHelper._formatUserInput(entry.userInput);
			console.log(`${Chalk.gray(`[${entry.timestamp}]`)} ${Chalk.cyan('user>')} ${text}`);
			return;
		}
		if (entry.kind === 'final_result') {
			const modelLabel = entry.model !== undefined && entry.model !== ''
				? ` ${Chalk.magenta(`(${entry.model})`)}`
				: '';
			console.log(`${Chalk.gray(`[${entry.timestamp}]`)} ${Chalk.green('agent>')}${modelLabel} ${entry.finalResult.text}`);
			return;
		}
	}

	private static _formatUserInput(input: SessionLogUserInput): string {
		if (typeof input === 'string') return input;
		const textParts: string[] = [];
		for (const item of input) {
			const content = (item as { content?: unknown }).content;
			if (typeof content === 'string') {
				textParts.push(content);
				continue;
			}
			if (Array.isArray(content) === false) continue;
			for (const part of content as Array<{ type?: string; text?: string }>) {
				if (typeof part.text === 'string' && part.text !== '') {
					textParts.push(part.text);
				}
			}
		}
		if (textParts.length === 0) {
			return JSON.stringify(input).slice(0, 200);
		}
		return textParts.join(' ');
	}

	private static _relSessionLabel(filePath: string, rootDir: string): string {
		const rel = Path.relative(rootDir, filePath);
		return rel.replace(/\.jsonl$/, '');
	}
}
