// node imports
import Path from 'path';
import Fs from 'node:fs';
import Assert from 'node:assert';


// npm imports
import * as OpenAiAgents from '@openai/agents';
import { OpenAI } from 'openai/index.js';
import { promptWithHandoffInstructions, removeAllTools } from '@openai/agents-core/extensions';
import { z as Zod } from 'zod'
import Chalk from 'chalk'

// local imports
import { AgentConfigHelper } from '../config/agent/agent_config_helper';
import { AgentRunnerContext, AgentRunnerConstants, AgentRunnerToolRunScriptOutput, AgentRunnerExtensions } from './agent_runner_types';
import { McpServerConfig } from '../config/mcp_server/mcp_server_types';
import { ScriptRunnerLocal } from '../script_runner/script_runner_local';
import { ScriptRunnerContainer } from '../script_runner/script_runner_container';
import { ContainerHelper } from '../script_runner/container_helper';
import { McpServerConfigHelper } from '../config/mcp_server/mcp_server_config_helper';
import { CommandDoc } from '../config/command/command_types';
import { CommandConfigHelper } from '../config/command/command_config_helper';
import { SkillDoc } from '../config/skill/skill_types';
import { SkilledCrewYamlConfig, SkilledCrewYamlConfigAgent, SkilledCrewYamlConfigSkill } from '../config/skilled_crew_yaml/skilled_crew_yaml_types';
import { SkilledCrewYamlConfigHelper } from '../config/skilled_crew_yaml/skilled_crew_yaml_config_helper';
import { AgentRunnerToolRunScriptInputSchema } from './agent_runner_schemas';
import { AiSessionStore } from '../session/ai_session_store';
import { SessionLogWriter } from '../session/session_log_writer';
import { UtilsAi } from '../libs/utils_ai';
import { CostBucketId } from '../libs/cost_bucket_id';
import { SkilletPaths } from '../libs/skillet_paths';

// `removeAllTools` strips every tool call + tool result item out of the
// conversation history before the receiving agent sees it, leaving only
// user/assistant text. Applied as `inputFilter` on every handoff (role-to-role,
// role-to-skill, skill-back-to-role) so large tool outputs (e.g. ~20 KB
// gather-sources JSON, per-cluster blackboard write echoes) don't pile up in
// chat context. The skillet pattern shares data via the blackboard, not via
// chat — agents only need to see the *intent* of prior turns to continue. See
// jeromeetienne/skillet_agent#103.
//
// Cast: removeAllTools is typed against the top-level @openai/agents-core
// install, while OpenAiAgents.handoff uses the nested copy under
// @openai/agents. Same JS function at runtime, but TS sees them as two
// different brand types — the cast is safe and unavoidable until the
// duplicate-install is deduped at the npm level.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HANDOFF_INPUT_FILTER = removeAllTools as any;

type ScriptRuntimeContext =
	| { kind: 'local' }
	| { kind: 'container'; containerName: string; botFolderPath: string };

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Agent initialization:
// 	- creates agents, tools, MCP server connections
// 	- loads configs based on the provided agentConfigFolder and appConfigFolder
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class AgentRunnerInit {
	static TOOL_NAME = {
		RUN_COMMAND_LINE: 'run_command_line',
		LOAD_SKILL_RESOURCES: 'load_skill_resources',
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	static async createAgentRunnerContext({
		skilledCrewYamlConfigPath,
		userId,
		sessionName,
		verboseLevel = 0,
		modelSpec,
		extensions,
	}: {
		skilledCrewYamlConfigPath: string,
		userId: string,
		sessionName: string,
		verboseLevel?: number,
		modelSpec?: string | undefined,
		extensions?: AgentRunnerExtensions | undefined,
	}): Promise<AgentRunnerContext> {
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Read SkilledCrewYamlConfig
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const skilledCrewYamlConfig: SkilledCrewYamlConfig = await SkilledCrewYamlConfigHelper.loadConfig(skilledCrewYamlConfigPath);

		const agentRunnerContext = await AgentRunnerInit.createAgentRunnerContextFromConfig({
			skilledCrewYamlConfig,
			userId,
			sessionName,
			verboseLevel,
			modelSpec,
			extensions,
		});
		return agentRunnerContext;
	}


	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	/**
	 * 
	 * @param param0 
	 * @returns 
	 */
	static async createAgentRunnerContextFromConfig({
		skilledCrewYamlConfig,
		userId,
		sessionName,
		verboseLevel = 0,
		modelSpec,
		extensions,
	}: {
		skilledCrewYamlConfig: SkilledCrewYamlConfig,
		userId: string,
		sessionName: string,
		verboseLevel?: number,
		modelSpec?: string | undefined,
		extensions?: AgentRunnerExtensions | undefined,
	}): Promise<AgentRunnerContext> {

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Handle commandDocs
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		let commandDocs: CommandDoc[] = [];
		commandDocs = await CommandConfigHelper.loadConfig(skilledCrewYamlConfig.commands)

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Build the script-runtime context (local vs container) and provision if needed
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const scriptRuntimeContext = await AgentRunnerInit._buildScriptRuntimeContext(skilledCrewYamlConfig, userId, verboseLevel);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Create all roleAgents
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const bucketId = CostBucketId.build({ userId, skilletId: skilledCrewYamlConfig.id, sessionId: sessionName });

		// Scoped run: a higher layer (the workflow orchestrator) may scope this run
		// to ONE specific role — e.g. a job worker loads only the job's assignee,
		// not the orchestrator or sibling worker roles. Otherwise the skillet's
		// `entryPointAgent` (typically the orchestrator) would receive the body +
		// worker tools and chat back about "delegating to research_agent" instead
		// of doing the work itself. The base chat runner injects nothing → null.
		const scopedAssignee: string | null = extensions?.resolveScopedAgentName?.(skilledCrewYamlConfig) ?? null;

		// Code-worker assignees (declaring `codeWorkerPath`) are deterministic
		// modules, not LLM agents — they never get a role agent here. In the job
		// lane the cli.ts code-worker fast path runs them before this is reached;
		// in chat mode they are simply not loadable as agents.
		const isLlmAgent = (n: string): boolean => skilledCrewYamlConfig.agents[n].codeWorkerPath === null;
		const agentNamesToLoad = (scopedAssignee !== null
			? Object.keys(skilledCrewYamlConfig.agents).filter((n) => n === scopedAssignee)
			: Object.keys(skilledCrewYamlConfig.agents)
		).filter(isLlmAgent);
		if (scopedAssignee !== null && agentNamesToLoad.length === 0) {
			throw new Error(`SKILLET_JOB_ID assignee "${scopedAssignee}" is not an LLM agent in the skillet agents map (is it a codeWorkerPath worker run outside the job-lane fast path?)`);
		}

		const roleAgents: OpenAiAgents.Agent[] = [];
		const roleAgentModelSpecs = new Map<OpenAiAgents.Agent, string>();
		for (const agentName of agentNamesToLoad) {
			const skilledCrewYamlConfigAgent = skilledCrewYamlConfig.agents[agentName];
			const { roleAgent, modelSpec: resolvedRoleModelSpec } = await AgentRunnerInit._createRoleAgent(agentName, skilledCrewYamlConfigAgent, {
				bucketId,
				verboseLevel,
				scriptRuntimeContext,
				modelSpec,
			});
			roleAgents.push(roleAgent);
			roleAgentModelSpecs.set(roleAgent, resolvedRoleModelSpec);
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Find the entryAgent
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////


		let entryAgent: OpenAiAgents.Agent | null = null;
		if (roleAgents.length === 0) {
			// TODO maybe i create the most basic agent possible ?
			throw new Error("No agents were created. Please check your configuration.");
		} else if (roleAgents.length === 1) {
			// if only one agent, return it directly without the need for orchestration
			entryAgent = roleAgents[0];
		} else {
			// sanity check
			Assert.ok(roleAgents.length > 1, "Here we should have at least 2 agents to orchestrate between");
			if (skilledCrewYamlConfig.entryPointAgent === null) {
				entryAgent = roleAgents[0];
			} else {
				const foundAgent = roleAgents.find((agent) => agent.name === skilledCrewYamlConfig.entryPointAgent);
				if (foundAgent === undefined) {
					throw new Error(`Entry point agent ${skilledCrewYamlConfig.entryPointAgent} specified in config not found among created agents`);
				}
				entryAgent = foundAgent;
			}
		}

		// sanity check - here we MUST have an entryAgent
		Assert.ok(entryAgent !== null, "Manager agent should have been created at this point");

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Handoff wiring between agents (manager agent can handoff to all other agents, but other agents can only handoff to the manager agent)
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// Build a short tool description for a handoff: the target agent's
		// frontmatter `description` (its handoffDescription). Do NOT embed the
		// target's full instructions in the description — that pollutes the
		// caller's context with the target's hard preconditions, confusing
		// worker agents into bouncing back to the orchestrator without doing
		// their work.
		const buildHandoffToolDescription = (targetAgent: OpenAiAgents.Agent): string => [
			`Hand off to ${targetAgent.name} when the user's intent is best served by that agent.`,
			`${targetAgent.name}: ${targetAgent.handoffDescription}`,
		].join("\n");

		if (roleAgents.length > 1) {
			for (const agent of roleAgents) {
				if (agent === entryAgent) {
					// manager agent can handoff to all other agents
					const newHandoffs = roleAgents.filter((agent) => agent !== entryAgent).map((targetAgent) => {
						const toolNameOverride = `handoff_to_${targetAgent.name.toLowerCase().replace(/\s+/g, '_')}`;
						const toolDescriptionOverride = buildHandoffToolDescription(targetAgent);
						const handoff = OpenAiAgents.handoff(targetAgent, {
							toolNameOverride,
							toolDescriptionOverride,
							inputFilter: HANDOFF_INPUT_FILTER,
						});
						return handoff;
					});
					agent.handoffs = [...agent.handoffs, ...newHandoffs];
				} else {
					// other agents can only handoff to the manager agent
					const toolNameOverride = `handoff_to_${entryAgent.name.toLowerCase().replace(/\s+/g, '_')}`;
					const toolDescriptionOverride = buildHandoffToolDescription(entryAgent);
					const newHandoffs = [
						OpenAiAgents.handoff(entryAgent, {
							toolNameOverride,
							toolDescriptionOverride,
							inputFilter: HANDOFF_INPUT_FILTER,
						})
					];
					agent.handoffs = [...agent.handoffs, ...newHandoffs];

					// Worker role agents (non-entry) must call a tool/handoff every
					// turn — otherwise reasoning-capable models like gpt-5 happily
					// produce "planning prose" ("Kicking off the run now…") and end
					// the run without ever invoking gather-sources / blackboard /
					// publish-brief. `toolChoice: 'required'` keeps them honest.
					// The entry agent is left on 'auto' so it can return the final
					// brief text to the user after the workers hand back.
					agent.modelSettings = { ...agent.modelSettings, toolChoice: 'required' };
				}
			}
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Display agent information
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		if (verboseLevel > 0) {
			const allAgents = AgentRunnerInit._collectAgents([entryAgent]);
			for (const agent of allAgents) {
				// display the header
				console.log(`[${Chalk.magenta('agent')}] ${Chalk.green(agent.name)} ${agent === entryAgent ? '(entry point)' : ''}`)
				const instructions: string = agent.instructions as string
				console.log(`  Instructions: ${Chalk.gray(instructions.substring(0, 120).replace(/\n/g, '\\n'))}`);
				const rawModel: unknown = agent.model;
				const modelLabel = typeof rawModel === 'string'
					? rawModel
					: (rawModel as { _model?: string })?._model ?? '(unknown)';
				console.log(`  Model: ${Chalk.cyan(modelLabel)}`);

				// display the tools
				if (agent.tools.length > 0) {
					console.log(`  Tools: ${agent.tools.map((tool: OpenAiAgents.Tool) => Chalk.cyan(tool.name)).join(', ')}`);
				}
				// display the handoffs
				if (agent.handoffs.length > 0) {
					console.log(`  Handoffs: ${agent.handoffs.map((handoff: OpenAiAgents.Handoff | OpenAiAgents.Agent) => {
						const targetAgent: OpenAiAgents.Agent = handoff instanceof OpenAiAgents.Handoff ? handoff.agent : handoff;
						return Chalk.cyan(targetAgent.name);
					}).join(', ')}`);
				}
				// display the MCP servers the agent is connected to
				if (agent.mcpServers.length > 0) {
					console.log(`  MCP Servers: ${agent.mcpServers.map((server: OpenAiAgents.MCPServer) => Chalk.cyan(server.name)).join(', ')}`);
				}
				// display the footer
				console.log(`---`); // separator for readability
			}
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Patch all agent.instructions 
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		for (const agent of AgentRunnerInit._collectAgents([entryAgent])) {
			// sanity check - here we should have only agents, no handoffs
			// Assert.ok(agent.handoffs.length > 0, "Agent instructions should be a string to patch with handoff instructions");
			// patch the instructions of each agent to include handoff instructions - RECOMMENDED_PROMPT_PREFIX
			agent.instructions = promptWithHandoffInstructions(agent.instructions as string)
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Worker bootstrap
		//	A higher layer (the workflow orchestrator) may attach extra tools and
		//	lifecycle to the entry agent here — e.g. a job worker attaches the
		//	`job_*` toolset and the worker lifecycle (heartbeat + first-tool-call
		//	hint + toolChoice: 'required'). The base chat runner injects nothing,
		//	so this is a no-op for plain chat/run.
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		await extensions?.workerBootstrap?.(entryAgent);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Create a session for the agent to use to persist information across runs, and pass it to the agent when running it
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// initialise the session
		const dbFilePath = SkilletPaths.agentSessionsDb();
		const aiSessionStore = new AiSessionStore(dbFilePath);
		const baseSession = await aiSessionStore.getOpenAiSession(userId, sessionName);

		// wrap the sqlite-backed session with the OpenAI compaction session decorator.
		// It auto-calls `responses.compact` after each turn once the candidate-item
		// count exceeds `compactThreshold`, then rewrites the underlying session
		// with the shorter summary. The user can also force compaction via `/compact`.
		const compactThreshold = 40;
		const maxTurns = AgentRunnerInit._resolveMaxTurns(process.env[AgentRunnerConstants.ENV_VAR_MAX_TURNS]);
		const agentSession = new OpenAiAgents.OpenAIResponsesCompactionSession({
			underlyingSession: baseSession,
			compactionMode: 'previous_response_id',
			shouldTriggerCompaction: ({ compactionCandidateItems }) => compactionCandidateItems.length > compactThreshold,
		});

		// build the append-only JSONL log writer — one file per conversation,
		// captures the full step-result stream so the web/CLI can replay a past
		// session verbatim (tool calls, handoffs, streamed text) through the
		// same renderer used for the live chat.
		const sessionLogFilePath = SessionLogWriter.filePathFor(SkilletPaths.agentSessionLogsDir(), userId, sessionName);
		const sessionLogWriter = new SessionLogWriter(sessionLogFilePath);

		// collect all mcp servers connected to any of the agents, so that we can pass them to the agent runner context for use in running the agent
		const mcpServers: OpenAiAgents.MCPServer[] = [];
		for (const roleAgent of roleAgents) {
			mcpServers.push(...roleAgent.mcpServers);
		}

		// Use the entry agent's resolved modelSpec so the JSONL session log
		// records the actual model that produced the final response — including
		// per-role-agent AGENTS.md `model:` frontmatter overrides.
		const entryAgentModelSpec = roleAgentModelSpecs.get(entryAgent);
		Assert.ok(entryAgentModelSpec !== undefined, 'entry agent must have a resolved modelSpec');

		const agentRunnerContext: AgentRunnerContext = {
			entryAgent,
			mcpServers,
			commandDocs,
			agentSession,
			compactThreshold,
			maxTurns,
			userId,
			sessionName,
			sessionLogWriter,
			modelSpec: entryAgentModelSpec,
			// Persist the injected hooks so run-time handlers (external slash
			// commands, lane router) can read them off the context. Conditional
			// spread keeps `extensions` absent (not `undefined`) under
			// exactOptionalPropertyTypes when nothing is injected.
			...(extensions !== undefined ? { extensions } : {}),
		}
		return agentRunnerContext;
	}

	// Resolve the per-run turn cap from SKILLET_MAX_TURNS. Pure (takes the raw env
	// value) so it is unit-testable. Unset → default; a non-positive-integer value
	// throws rather than silently coercing (mirrors UtilsAi.parseProviderModel).
	static _resolveMaxTurns(raw: string | undefined): number {
		if (raw === undefined || raw === '') {
			return AgentRunnerConstants.DEFAULT_MAX_TURNS;
		}
		const value = Number(raw);
		if (Number.isInteger(value) === false || value <= 0) {
			throw new Error(`${AgentRunnerConstants.ENV_VAR_MAX_TURNS} must be a positive integer, got '${raw}'`);
		}
		return value;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Debugging and logging functions to visualize the agent orchestration and handoffs
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static _collectAgents(
		agentOrHandoffs: (OpenAiAgents.Handoff | OpenAiAgents.Agent)[],
		visitedAgents: Set<OpenAiAgents.Agent> = new Set(),
	): Array<OpenAiAgents.Agent> {
		for (const agentOrHandoff of agentOrHandoffs) {
			const agent: OpenAiAgents.Agent = agentOrHandoff instanceof OpenAiAgents.Handoff ? agentOrHandoff.agent : agentOrHandoff;
			// if we've already visited this agent, skip to avoid infinite loops in case of circular handoffs
			if (visitedAgents.has(agent)) continue;
			// add the agent to the visited set
			visitedAgents.add(agent);
			// recursively collect agents from the handoffs of this agent
			if (agent.handoffs.length > 0) {
				AgentRunnerInit._collectAgents(agent.handoffs, visitedAgents);
			}
		}
		// return the collected agents as an array
		return Array.from(visitedAgents);
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Create role agent, which orchestrates between skillAgents based on user input
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static async _buildScriptRuntimeContext(
		skilledCrewYamlConfig: SkilledCrewYamlConfig,
		userId: string,
		verboseLevel: number,
	): Promise<ScriptRuntimeContext> {
		if (skilledCrewYamlConfig.script_runtime.kind === 'local') {
			return { kind: 'local' };
		}
		// kind === 'container'
		if (skilledCrewYamlConfig.script_runtime.dockerfile === null) {
			throw new Error(`script_runtime.kind=container requires script_runtime.dockerfile to be set in the .skilled_crew.yaml`);
		}
		const dockerfilePath = skilledCrewYamlConfig.script_runtime.dockerfile;
		const botFolderPath = Path.dirname(dockerfilePath);
		const botId = skilledCrewYamlConfig.id;
		const containerName = ContainerHelper.containerName(botId, userId);
		if (verboseLevel > 0) {
			console.log(`[${Chalk.magenta('runtime')}] provisioning container ${Chalk.green(containerName)} from ${Chalk.cyan(dockerfilePath)}`);
		}
		await ContainerHelper.provision(botFolderPath, botId, userId, dockerfilePath);
		return { kind: 'container', containerName, botFolderPath };
	}

	private static async _createRoleAgent(agentName: string, skilledCrewYamlConfigAgent: SkilledCrewYamlConfigAgent, {
		bucketId,
		verboseLevel = 0,
		scriptRuntimeContext,
		modelSpec: explicitModelSpec,
	}: {
		bucketId: string,
		verboseLevel?: number,
		scriptRuntimeContext: ScriptRuntimeContext,
		modelSpec?: string | undefined,
	}): Promise<{ roleAgent: OpenAiAgents.Agent, modelSpec: string }> {
		const agentConfig = await AgentConfigHelper.loadConfig(skilledCrewYamlConfigAgent);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// initialize OpenAI client
		const modelSpec = explicitModelSpec
			?? process.env.SKILLET_MODEL_RUNNER
			?? agentConfig.agents?.header.model
			?? 'openai/gpt-4.1-nano';
		const { provider, modelName } = UtilsAi.parseProviderModel(modelSpec);
		const openaiClient = await UtilsAi.getOpenAiClient({
			provider,
			bucketId: bucketId,
		})
		// @ts-expect-error
		const openaiAgentModel = new OpenAiAgents.OpenAIResponsesModel(openaiClient, modelName);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Create all the subAgents
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const skillAgentInfos: {
			skillAgent: OpenAiAgents.Agent,
			skillDoc: SkillDoc,
		}[] = [];
		for (const skillDoc of agentConfig.skillDocs) {
			const skilledCrewYamlConfigSkill = skilledCrewYamlConfigAgent.skills.find((configSkill) => configSkill.name === skillDoc.header.name);
			if (skilledCrewYamlConfigSkill === undefined) {
				throw new Error(`No matching skill config found in skilled_crew_yaml for skill doc: ${skillDoc.header.name}`);
			}
			const skillAgent = await AgentRunnerInit._createSkillAgent(skillDoc, skilledCrewYamlConfigSkill, {
				openaiAgentModel,
				verboseLevel,
				scriptRuntimeContext,
			});
			skillAgentInfos.push({
				skillAgent: skillAgent,
				skillDoc: skillDoc
			});
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Compose the role agent's instructions
		//	The agent's own AGENTS.md body defines its role. We only prepend the
		//	`load_skill_resources` hint, which is a framework-provided tool. Do NOT
		//	prepend an "orchestrator" framing: in multi-role-agent skillets this
		//	confuses worker agents (research/analyst/writer) into bouncing handoffs
		//	back to the entry agent instead of executing their role.
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		let roleInstructions = [
			`- if any markdown link is relevant to the user input, use the ${AgentRunnerInit.TOOL_NAME.LOAD_SKILL_RESOURCES} tool to read its content before proceeding.`,
			``,
			`# AGENTS.md:`,
			`${agentConfig.agents?.body}`,
		].join("\n");

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Handle mcpServerConfigs and connections
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const mcpServerConfigs = await McpServerConfigHelper.loadConfig(skilledCrewYamlConfigAgent.mcp_servers);

		// connect to mcp servers
		let mcpServers: OpenAiAgents.MCPServer[] = [];
		for (const mcpServerConfig of mcpServerConfigs) {
			// Create an MCP server instance based on the config
			const mcpServer = await AgentRunnerInit._buildMcpServer(mcpServerConfig);

			// log the connection for debugging
			if (verboseLevel > 0) {
				console.log(`[${Chalk.magenta('MCP')}] Connecting server: ${Chalk.green(mcpServer.name)} `);
			}

			// connect to the MCP server (establishes the connection and performs any necessary handshakes)
			await mcpServer.connect();

			// add to the list of connected MCP servers to pass to agents
			mcpServers.push(mcpServer);
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Create tools for the role agent
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const agentTools: OpenAiAgents.Tool[] = [];

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Create role agent
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// Use the role agent's own AGENTS.md frontmatter `description` as its
		// handoffDescription so other agents see "Hand off to research_agent to
		// fetch raw signal..." instead of the same generic placeholder for every
		// agent. Falls back to the placeholder if no description is present.
		const roleHandoffDescription = agentConfig.agents?.header.description
			?? "Hand off here when the current task is complete or the user's intent is unclear.";

		const roleAgent = OpenAiAgents.Agent.create({
			name: agentName,
			instructions: roleInstructions.trim(),
			mcpServers,
			model: openaiAgentModel,
			tools: agentTools,
			handoffDescription: roleHandoffDescription,
		});

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Depending on the orchestration mode, either add all skill agents as tools to the orchestrator, 
		// 	or wire up handoffs between all agents
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// Star wiring inside a role group: the role agent can hand off to any of
		// its skills, and each skill can only hand back to the role agent. We do
		// NOT wire sibling-to-sibling skill handoffs (e.g. gather-sources →
		// blackboard) — there is no use case for that, and it gives the model an
		// extra escape valve to bounce without doing work.
		//
		// Every handoff carries the `removeAllTools` input filter: by the time
		// control comes back to the role agent, the skill's `run_command_line`
		// tool args + result (which is where the heavy payloads live — ~20 KB
		// gather-sources JSON, blackboard write echoes, etc.) are stripped from
		// chat history. The role agent still sees the skill's final text
		// confirmation; if it needs the data itself it goes to the blackboard.
		// See jeromeetienne/skillet_agent#103.
		const skillAgents: OpenAiAgents.Agent[] = skillAgentInfos.map(({ skillAgent }) => skillAgent);
		roleAgent.handoffs = skillAgents.map((targetSkill) => OpenAiAgents.handoff(targetSkill, { inputFilter: HANDOFF_INPUT_FILTER }));
		for (const skillAgent of skillAgents) {
			skillAgent.handoffs = [OpenAiAgents.handoff(roleAgent, { inputFilter: HANDOFF_INPUT_FILTER })];
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Return the role agent
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		return { roleAgent, modelSpec };
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Mcp servers
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static async _buildMcpServer(config: McpServerConfig): Promise<OpenAiAgents.MCPServer> {
		if (config.type === 'stdio') {
			return new OpenAiAgents.MCPServerStdio({
				name: config.name,
				command: config.command,
				args: config.args ?? [],
				env: config.env ?? {},
				cwd: config.cwd ?? process.cwd()
			});
		} else if (config.type === 'http') {
			return new OpenAiAgents.MCPServerStreamableHttp({ name: config.name, url: config.url });
		} else if (config.type === 'sse') {
			return new OpenAiAgents.MCPServerSSE({ name: config.name, url: config.url });
		} else {
			// @ts-expect-error
			throw new Error(`Unsupported MCP server type: ${config.type}`);
		}
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Create skillAgents
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	/**
	 * Create an skillAgent
	 * 
	 * @param skillDoc - the markdown doc that describes the skill and contains the instructions for the agent
	 * @param skilledCrewYamlConfigSkill - the config for this skill from the skilled_crew_yaml, which contains the folder path for the skill that the agent can use to run command line scripts
	 * @param param2.verbose
	 * @param param2.orchestrationMode - the orchestration mode to use for the agents, either 'handoff-any-to-any' or 'skill-as-tool'. NOT REALLY WORKING
	 * @returns 
	 */
	private static async _createSkillAgent(skillDoc: SkillDoc, skilledCrewYamlConfigSkill: SkilledCrewYamlConfigSkill, {
		openaiAgentModel,
		verboseLevel = 0,
		scriptRuntimeContext,
	}: {
		openaiAgentModel: OpenAiAgents.Model,
		verboseLevel?: number,
		scriptRuntimeContext: ScriptRuntimeContext,
	}): Promise<OpenAiAgents.Agent> {
		// Build the prompt for the skill-agent based on the skill doc content
		let subSkillAgentPrompt = [
			`${skillDoc.body}`,
			``,
			`# SKILL INSTRUCTIONS`,
			`- Your job is to perform this skill's action by invoking the ${AgentRunnerInit.TOOL_NAME.RUN_COMMAND_LINE} tool. This is REQUIRED before you do anything else.`,
			`- If the user input does not specify which command and you can infer a sensible default from your SKILL.md documentation, do so and invoke ${AgentRunnerInit.TOOL_NAME.RUN_COMMAND_LINE}. Do not ask for clarification.`,
			`- Use ${AgentRunnerInit.TOOL_NAME.LOAD_SKILL_RESOURCES} only when a referenced markdown resource is needed before you can build the command line.`,
			`- After ${AgentRunnerInit.TOOL_NAME.RUN_COMMAND_LINE} returns, you MUST immediately invoke the handoff back to your caller agent. The handoff is your only allowed next action — do not produce a text-only response, do not summarize, do not end the turn with prose. Returning control via the handoff is how the caller continues its workflow; producing text and ending instead silently kills the multi-agent pipeline.`,
			`- The only tools or handoffs you may call are: ${AgentRunnerInit.TOOL_NAME.RUN_COMMAND_LINE}, ${AgentRunnerInit.TOOL_NAME.LOAD_SKILL_RESOURCES}, and the handoff back to your caller.`,
		].join("\n")

		// create a skill agent for this skill doc
		const skillAgent = new OpenAiAgents.Agent({
			name: skillDoc.header.name,
			model: openaiAgentModel,
			instructions: subSkillAgentPrompt.trim(),
			tools: [
				await AgentRunnerInit._createToolLoadSkillResources(skillDoc, verboseLevel),
				await AgentRunnerInit._createToolRunCommandLine(skillDoc, skilledCrewYamlConfigSkill, verboseLevel, scriptRuntimeContext)
			],
			handoffDescription: skillDoc.header.description,
			// Skill agents exist to run commands. Force the model to invoke a tool
			// or handoff every turn — otherwise reasoning-capable models like gpt-5
			// happily produce planning prose ("I'll run the command…") and end the
			// run without actually invoking run_command_line.
			modelSettings: { toolChoice: 'required' },
		});
		return skillAgent;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Create tools functions
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	/**
	 * Create a tool that allows skill agents to load reference files from their skill folder.
	 * Prevents path traversal attacks by validating that files are within references/ and the skill folder.
	 */
	private static async _createToolLoadSkillResources(skillDoc: SkillDoc, verboseLevel: number): Promise<OpenAiAgents.Tool> {
		const tool = OpenAiAgents.tool({
			name: AgentRunnerInit.TOOL_NAME.LOAD_SKILL_RESOURCES,
			description: [
				'Load a file from the references/ folder of this skill.',
				'Call this when the skill instructions reference a file you need to read before proceeding.',
			].join(' '),
			parameters: Zod.object({
				resources: Zod.array(Zod.object({
					path: Zod.string().describe('Relative path inside references/, e.g. "references/aws.md"'),
					reason: Zod.string().describe('Why this file is needed for the current task'),
				})),
			}),
			async execute({ resources }: { resources: Array<{ path: string, reason: string }> }) {
				// log to debug
				// if (verboseLevel > 0) {
				// 	for (const resource of resources) {
				// 		console.log(`[${Chalk.magenta(skillDoc.header.name)}][${Chalk.cyan('Tool')}] Loading resource: ${Chalk.cyan(resource.path)} reason: ${Chalk.gray(resource.reason)}`);
				// 	}
				// }
				const skillFolderPath = Path.dirname(skillDoc.filePath);
				const results: Record<string, string> = {};
				for (const { path: relPath } of resources) {
					if (relPath.startsWith('references/') === false) {
						results[relPath] = `ERROR: only files inside references/ can be loaded`;
						continue;
					}
					const absPath = Path.resolve(skillFolderPath, relPath);
					if (absPath.startsWith(skillFolderPath + Path.sep) === false) {
						results[relPath] = `ERROR: path traversal not allowed`;
						continue;
					}
					try {
						results[relPath] = await Fs.promises.readFile(absPath, 'utf8');
					} catch {
						results[relPath] = `ERROR: file not found`;
					}
				}
				return JSON.stringify(results);
			},
		});
		return tool;
	}

	/**
	 * Create a tool that allows skill agents to execute command line scripts from their skill folder.
	 */
	private static async _createToolRunCommandLine(
		skillDoc: SkillDoc,
		skilledCrewYamlConfigSkill: SkilledCrewYamlConfigSkill,
		verboseLevel: number,
		scriptRuntimeContext: ScriptRuntimeContext,
	): Promise<OpenAiAgents.Tool> {
		// log the creation of the tool
		async function executeFn({ commandLine }: { commandLine: string }) {
			// Security checks (structural + allowed-tools) run by default on this live tool path.
			// They can be disabled for local testing only via SKILLET_BYPASS_SECURITY=1 — never set this in production.
			const bypassSecurity = process.env.SKILLET_BYPASS_SECURITY === '1' || process.env.SKILLET_BYPASS_SECURITY === 'true';
			let execResult: AgentRunnerToolRunScriptOutput = { exitCode: null, stdout: '', stderr: '', timedOut: false };
			try {
				if (scriptRuntimeContext.kind === 'container') {
					execResult = await ScriptRunnerContainer.runCommand(
						commandLine,
						skilledCrewYamlConfigSkill.folderPath,
						skillDoc.header.allowedTools ?? [],
						{
							containerName: scriptRuntimeContext.containerName,
							botFolderPath: scriptRuntimeContext.botFolderPath,
							bypassSecurity,
						},
					);
				} else {
					execResult = await ScriptRunnerLocal.runCommand(commandLine, skilledCrewYamlConfigSkill.folderPath, skillDoc.header.allowedTools ?? [], {
						bypassSecurity,
					});
				}
			} catch (error) {
				execResult = {
					exitCode: null,
					stdout: '',
					stderr: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
					timedOut: false
				}
			}

			// return the result
			return JSON.stringify(execResult);
		}
		// create a tool that allows the agent to run command line scripts from their skill folder
		const tool = OpenAiAgents.tool({
			name: AgentRunnerInit.TOOL_NAME.RUN_COMMAND_LINE,
			description: 'Run a shell command line script',
			parameters: AgentRunnerToolRunScriptInputSchema,
			execute: executeFn,
		});
		// return the tool
		return tool;
	}

}