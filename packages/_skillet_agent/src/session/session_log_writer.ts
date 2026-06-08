// node imports
import Path from 'node:path';
import Fs from 'node:fs';

// local imports
import type { AgentRunnerFinalResult, AgentRunnerStepResult } from '../agent_runner/agent_runner_types';
import {
	SessionLogEntry,
	SessionLogEntryFinalResult,
	SessionLogEntryStep,
	SessionLogEntryUserMessage,
	SessionLogTypes,
	SessionLogUserInput,
} from './session_log_types';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Append-only JSONL writer for the full SSE step-result stream.
//
//	Writes are serialized via an internal promise chain. This lets the hot path
//	in AgentRunner fire-and-forget `void writer.appendStep(result)` without
//	risking interleaved JSON lines if two writes race. The end-of-turn
//	`await writer.appendFinalResult(...)` naturally drains the chain.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class SessionLogWriter {
	private readonly _filePath: string;
	private _writeTail: Promise<void> = Promise.resolve();
	private _parentDirReady: boolean = false;

	constructor(filePath: string) {
		this._filePath = filePath;
	}

	get filePath(): string {
		return this._filePath;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Path helper shared with the reader so both ends resolve the same location
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	static filePathFor(logsDir: string, userId: string, sessionName: string): string {
		const userSlug = SessionLogTypes.sanitizeForPath(userId);
		const sessionSlug = SessionLogTypes.sanitizeForPath(sessionName);
		return Path.resolve(logsDir, userSlug, `${sessionSlug}.jsonl`);
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Public append API — one method per entry kind
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	appendUserMessage(userInput: SessionLogUserInput): Promise<void> {
		const entry: SessionLogEntryUserMessage = {
			kind: 'user_message',
			userInput: userInput,
			timestamp: new Date().toISOString(),
		};
		return this._enqueue(entry);
	}

	appendStep(stepResult: AgentRunnerStepResult): Promise<void> {
		const entry: SessionLogEntryStep = {
			kind: 'step',
			stepResult: stepResult,
			timestamp: new Date().toISOString(),
		};
		return this._enqueue(entry);
	}

	appendFinalResult(finalResult: AgentRunnerFinalResult, options: { model?: string } = {}): Promise<void> {
		const entry: SessionLogEntryFinalResult = {
			kind: 'final_result',
			finalResult: finalResult,
			timestamp: new Date().toISOString(),
		};
		if (options.model !== undefined && options.model !== '') {
			entry.model = options.model;
		}
		return this._enqueue(entry);
	}

	/**
	 * Await the tail of the write queue so all pending fire-and-forget writes
	 * have been flushed to disk.
	 */
	drain(): Promise<void> {
		return this._writeTail;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Private
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private _enqueue(entry: SessionLogEntry): Promise<void> {
		this._writeTail = this._writeTail.then(() => this._doAppend(entry));
		return this._writeTail;
	}

	private async _doAppend(entry: SessionLogEntry): Promise<void> {
		if (this._parentDirReady === false) {
			await Fs.promises.mkdir(Path.dirname(this._filePath), { recursive: true });
			this._parentDirReady = true;
		}
		const line = JSON.stringify(entry) + '\n';
		await Fs.promises.appendFile(this._filePath, line, 'utf8');
	}
}
