// npm imports
import * as OpenAiAgents from '@openai/agents';

// local imports
import type { AgentRunnerFinalResult, AgentRunnerStepResult } from '../agent_runner/agent_runner_types';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	JSONL session log entry schema
//
//	A conversation is persisted as a strictly append-only JSONL file. A "turn"
//	is one user_message entry followed by zero-or-more step entries, closed by
//	one final_result entry. The file is the canonical UI replay source for
//	both the web chat and the CLI (SQLite remains the canonical LLM-context).
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export type SessionLogUserInput = string | OpenAiAgents.protocol.UserMessageItem[];

export type SessionLogEntryUserMessage = {
	kind: 'user_message';
	userInput: SessionLogUserInput;
	timestamp: string;
}

export type SessionLogEntryStep = {
	kind: 'step';
	stepResult: AgentRunnerStepResult;
	timestamp: string;
}

export type SessionLogEntryFinalResult = {
	kind: 'final_result';
	finalResult: AgentRunnerFinalResult;
	timestamp: string;
	model?: string;
}

export type SessionLogEntry =
	| SessionLogEntryUserMessage
	| SessionLogEntryStep
	| SessionLogEntryFinalResult;

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Grouped turn — the reader produces these for consumption by replay generators
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export type SessionLogTurn = {
	userInput: SessionLogUserInput;
	stepResults: AgentRunnerStepResult[];
	finalResult: AgentRunnerFinalResult;
}

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Shared filename sanitizer — used by both the writer (core) and the web
//	replay endpoint so both ends resolve the same path for a given userId +
//	sessionName.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class SessionLogTypes {
	static sanitizeForPath(name: string): string {
		return name
			.trim()
			.replace(/[^a-zA-Z0-9_-]+/g, '_')
			.replace(/^_+|_+$/g, '');
	}
}
