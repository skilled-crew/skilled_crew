import * as OpenAiAgents from '@openai/agents';
import { CommandDoc } from '../config/command/command_types';
import { ScriptRunnerOutput } from '../script_runner/script_runner_types';
import type { SessionLogWriter } from '../session/session_log_writer';
import type { SkilledCrewYamlConfig } from '../config/skilled_crew_yaml/skilled_crew_yaml_types';

export type AgentRunnerContext = {
	entryAgent: OpenAiAgents.Agent,
	// TODO add a .roleAgents ?
	mcpServers: OpenAiAgents.MCPServer[],
	commandDocs: CommandDoc[],
	agentSession: OpenAiAgents.OpenAIResponsesCompactionSession,
	compactThreshold: number,
	maxTurns: number,
	userId: string,
	sessionName: string,
	sessionLogWriter: SessionLogWriter,
	modelSpec: string,
	// Optional dependency-injection seam: a higher layer (e.g. the workflow/job
	// orchestrator) supplies job-lane behavior here. The base chat runner injects
	// nothing — it knows nothing about jobs, boards, or dispatchers.
	extensions?: AgentRunnerExtensions,
}

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	AgentRunnerExtensions — dependency-injection seam (no job code in the base)
//	The base agent runner is job-agnostic. A higher layer injects these optional
//	hooks to add lane behavior without the base importing any job-lane module.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

/**
 * Result of handling an external (config-driven) slash command.
 * - 'forward': command produced a prompt that should be sent to the agent
 * - 'final':   command produced its own final answer; skip the agent run
 *   (e.g. unknown command, or a non-chat-lane command that posted to a board)
 */
export type ExternalCommandResult =
	| { kind: 'forward'; userInput: string }
	| { kind: 'final'; text: string; jobIds?: string[] };

/**
 * A REPL slash command contributed by the injected layer (replaces the
 * hard-coded /jobs /show /comment /unblock branches). `name` is without the
 * leading '/'. `handler` receives the text after the command name and returns
 * the response string to display.
 */
export type ExternalSlashCommand = {
	name: string;
	description: string;
	handler: (context: AgentRunnerContext, argsText: string) => string | Promise<string>;
};

export type AgentRunnerExtensions = {
	// build-time: pick the single role to load for a scoped worker run (replaces
	// the SKILLET_JOB_ID JobStore peek). Returns null to load all roles.
	resolveScopedAgentName?: (config: SkilledCrewYamlConfig) => string | null;
	// build-time: attach extra tools + lifecycle to the entry agent (replaces the
	// JobTools / JobWorkerLifecycle worker bootstrap).
	workerBootstrap?: (entryAgent: OpenAiAgents.Agent) => void | Promise<void>;
	// run-time: extra REPL slash commands (replaces /jobs /show /comment /unblock).
	externalSlashCommands?: ExternalSlashCommand[];
	// run-time: handle command docs whose header.lane is not 'chat' (replaces the
	// lane:'job' routing). Returns null when it does not handle the command.
	laneCommandRouter?: (
		context: AgentRunnerContext,
		commandDoc: CommandDoc,
		argsText: string,
	) => ExternalCommandResult | null;
};
export class AgentRunnerConstants {
	static readonly EVENT = {
		AGENT_START: 'agent_start',
		AGENT_END: 'agent_end',
		AGENT_TOOL_START: 'agent_tool_start',
		AGENT_TOOL_END: 'agent_tool_end',
		HANDOFF: 'handoff',
		TEXT: 'text',
	} as const;

	static readonly DEFAULT_USER_ID = 'default_user';
	static readonly DEFAULT_SESSION_NAME = 'default_session';

	// Per-run turn cap handed to OpenAiAgents.run(). Overridable via
	// SKILLET_MAX_TURNS so dev can cap turns low to bound cost (#193).
	static readonly ENV_VAR_MAX_TURNS = 'SKILLET_MAX_TURNS';
	static readonly DEFAULT_MAX_TURNS = 50;
}

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export const AgentRunnerToolRunScriptName = 'run_command_line';
export type AgentRunnerToolRunScriptInput = {
	reason: string;
	commandLine: string;
}
export type AgentRunnerToolRunScriptOutput = ScriptRunnerOutput;

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export type AgentRunnerStepResultAgentStart = {
	type: typeof AgentRunnerConstants.EVENT.AGENT_START;
	agentName: string;
};

export type AgentRunnerStepResultAgentEnd = {
	type: typeof AgentRunnerConstants.EVENT.AGENT_END;
	agentName: string;
};

export type AgentRunnerStepResultToolStart = {
	type: typeof AgentRunnerConstants.EVENT.AGENT_TOOL_START;
	agentName: string;
	toolName: string;
	toolArgumentsStr: string;
};

export type AgentRunnerStepResultToolEnd = {
	type: typeof AgentRunnerConstants.EVENT.AGENT_TOOL_END;
	agentName: string;
	toolName: string;
	result: string;
};

export type AgentRunnerStepResultHandoff = {
	type: typeof AgentRunnerConstants.EVENT.HANDOFF;
	agentName: string;
	toAgentName: string;
};

export type AgentRunnerStepResultText = {
	type: typeof AgentRunnerConstants.EVENT.TEXT;
	text: string;
};


export type AgentRunnerStepResult =
	AgentRunnerStepResultAgentStart |
	AgentRunnerStepResultAgentEnd |
	AgentRunnerStepResultToolStart |
	AgentRunnerStepResultToolEnd |
	AgentRunnerStepResultHandoff |
	AgentRunnerStepResultText


export type AgentRunnerFinalResult = {
	text: string;
	// Set when the turn was a `lane: job` command that posted a job graph — the
	// created job ids (topological order). Lets a viewer auto-stream the new crew.
	jobIds?: string[];
};

