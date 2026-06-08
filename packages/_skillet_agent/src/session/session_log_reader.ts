// node imports
import Fs from 'node:fs';

// local imports
import { AgentRunnerFinalResult, AgentRunnerStepResult } from '../agent_runner/agent_runner_types';
import { SessionLogEntry, SessionLogTurn, SessionLogUserInput } from './session_log_types';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Read-only companion to SessionLogWriter. Parses a JSONL log into turns and
//	reconstructs live-shaped async generators so the same renderer code can
//	consume either a live AgentRunner stream or a replayed one.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class SessionLogReader {

	/**
	 * Read the whole JSONL file and parse each non-empty line. Malformed lines
	 * are skipped silently — a partial/aborted write at the tail of the file
	 * must not poison the rest of the replay.
	 */
	static async readAll(filePath: string): Promise<SessionLogEntry[]> {
		const fileContent = await Fs.promises.readFile(filePath, 'utf8');
		const lines = fileContent.split('\n');
		const entries: SessionLogEntry[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed === '') continue;
			try {
				const entry = JSON.parse(trimmed) as SessionLogEntry;
				entries.push(entry);
			} catch {
				// skip malformed line — likely a torn write at crash time
			}
		}
		return entries;
	}

	/**
	 * Group entries into turn buckets. A turn starts with a `user_message` and
	 * ends with the matching `final_result`. Orphan turns (user_message without
	 * a terminating final_result, e.g. a crash mid-turn) are yielded with a
	 * synthetic final_result so replay still renders what was captured.
	 */
	static async *iterateTurns(filePath: string): AsyncGenerator<SessionLogTurn, void> {
		const entries = await SessionLogReader.readAll(filePath);

		let currentUserInput: SessionLogUserInput | null = null;
		let currentSteps: AgentRunnerStepResult[] = [];

		for (const entry of entries) {
			if (entry.kind === 'user_message') {
				// flush a dangling prior turn as an incomplete bucket
				if (currentUserInput !== null) {
					yield {
						userInput: currentUserInput,
						stepResults: currentSteps,
						finalResult: SessionLogReader._syntheticFinalResult(currentSteps),
					};
				}
				currentUserInput = entry.userInput;
				currentSteps = [];
			} else if (entry.kind === 'step') {
				if (currentUserInput !== null) {
					currentSteps.push(entry.stepResult);
				}
			} else if (entry.kind === 'final_result') {
				if (currentUserInput !== null) {
					yield {
						userInput: currentUserInput,
						stepResults: currentSteps,
						finalResult: entry.finalResult,
					};
					currentUserInput = null;
					currentSteps = [];
				}
			}
		}

		// flush any trailing incomplete turn so partial conversations still render
		if (currentUserInput !== null) {
			yield {
				userInput: currentUserInput,
				stepResults: currentSteps,
				finalResult: SessionLogReader._syntheticFinalResult(currentSteps),
			};
		}
	}

	/**
	 * Reconstruct a live-shaped async generator for a single turn. Yields each
	 * step result then returns the final result — same shape as
	 * AgentRunner.runOneShotAsyncGenerator so the same consumer code works.
	 */
	static async *turnGenerator(
		turn: SessionLogTurn,
	): AsyncGenerator<AgentRunnerStepResult, AgentRunnerFinalResult> {
		for (const stepResult of turn.stepResults) {
			yield stepResult;
		}
		return turn.finalResult;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Private
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static _syntheticFinalResult(stepResults: AgentRunnerStepResult[]): AgentRunnerFinalResult {
		let accumulatedText = '';
		for (const stepResult of stepResults) {
			if (stepResult.type === 'text') {
				accumulatedText += stepResult.text;
			}
		}
		const text = accumulatedText.trim() === '' ? '[incomplete turn]' : accumulatedText;
		return { text };
	}
}
