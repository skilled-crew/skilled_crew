// node imports
import Fs from 'node:fs';

// local imports
import { SessionLogEntry } from './session_log_types';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Live companion to SessionLogReader. Where the reader parses a finished JSONL
//	log in one shot, the tailer FOLLOWS a log that is still being appended to by
//	another process (a job worker) and yields each new entry as it lands — so the
//	web/CLI can render a running job's "thinking" through the same renderer used
//	for live chat and replay.
//
//	Works for finished logs too: when `isDone()` is already true the first drain
//	emits the whole file, then it returns — i.e. it degrades to a one-shot read.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export type SessionLogTailerOptions = {
	/** True once the producing run has ended; the tailer does one final drain then stops. */
	isDone: () => boolean | Promise<boolean>;
	/** True if the consumer went away (client disconnect); the tailer stops promptly. */
	isAborted?: () => boolean;
	/** Poll interval while waiting for new appends. Default 300ms. */
	pollMs?: number;
};

type TailState = {
	offset: number;
	pending: string;
};

export class SessionLogTailer {

	/**
	 * Follow `filePath`, yielding each newly-appended SessionLogEntry until the
	 * run is done (then one final drain) or the consumer aborts. A missing file
	 * is treated as empty and polled until it appears. Malformed/torn lines are
	 * skipped, exactly like SessionLogReader.readAll.
	 */
	static async *follow(filePath: string, options: SessionLogTailerOptions): AsyncGenerator<SessionLogEntry, void> {
		const pollMs = options.pollMs ?? 300;
		const state: TailState = { offset: 0, pending: '' };

		while (true) {
			if (options.isAborted?.() === true) return;

			for (const entry of await SessionLogTailer._drain(filePath, state)) {
				yield entry;
			}

			if (await options.isDone() === true) {
				if (options.isAborted?.() === true) return;
				// Final drain — the producer may have flushed its last lines (e.g.
				// the final_result) between our last read and ending the run.
				for (const entry of await SessionLogTailer._drain(filePath, state)) {
					yield entry;
				}
				return;
			}

			await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
		}
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Private
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	/**
	 * Read the bytes appended since the last call (tracked in `state.offset`),
	 * carrying a trailing partial line across calls so a half-written final line
	 * is never parsed until it is complete.
	 */
	private static async _drain(filePath: string, state: TailState): Promise<SessionLogEntry[]> {
		let stat: Fs.Stats;
		try {
			stat = await Fs.promises.stat(filePath);
		} catch {
			// File not created yet — nothing to read.
			return [];
		}
		if (stat.size <= state.offset) {
			return [];
		}

		const length = stat.size - state.offset;
		const buffer = Buffer.alloc(length);
		const fileHandle = await Fs.promises.open(filePath, 'r');
		try {
			await fileHandle.read(buffer, 0, length, state.offset);
		} finally {
			await fileHandle.close();
		}
		state.offset = stat.size;
		state.pending += buffer.toString('utf8');

		const lines = state.pending.split('\n');
		state.pending = lines.pop() ?? '';

		const entries: SessionLogEntry[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed === '') continue;
			try {
				entries.push(JSON.parse(trimmed) as SessionLogEntry);
			} catch {
				// torn write — skip, mirrors SessionLogReader.readAll
			}
		}
		return entries;
	}
}
