import { z as Zod } from 'zod';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

const SkilledCrewYamlConfigCommandZod = Zod.object({
	name: Zod.string()
		.describe('Name of the slash command. The user invokes it during chat by typing `/<name> [arguments]`. Must be unique within this skillet.'),
	filePath: Zod.string()
		.describe('Path to the `.command.md` file containing the command instructions. Relative to the .skilled_crew.yaml file. `$ARGUMENTS` inside the file is substituted with the text the user typed after the command name.'),
}).strict()
	.describe('Definition of a single slash command available to the user during chat.');

const SkilledCrewYamlConfigMcpServerZod = Zod.object({
	filePath: Zod.string()
		.describe('Path to a JSON file describing an MCP (Model Context Protocol) server (command, args, env). Relative to the .skilled_crew.yaml file. The agent gets the MCP server\'s tools.'),
}).strict()
	.describe('Reference to an MCP server config file. The agent that lists it gets the server\'s tools.');

const SkilledCrewYamlConfigSkillZod = Zod.object({
	name: Zod.string()
		.describe('Skill name. Used by the orchestrator to route user requests to this skill. Should match the folder name and the `name` in the skill\'s SKILL.md frontmatter.'),
	folderPath: Zod.string()
		.describe('Path to the skill folder. Relative to the .skilled_crew.yaml file. The folder must contain a SKILL.md (frontmatter + instructions) and may contain executable scripts that the skill can call.'),
}).strict()
	.describe('Reference to a skill folder. Each skill becomes a tool-calling sub-agent that the orchestrator can route to.');

const SkilledCrewYamlConfigAgentZod = Zod.object({
	instructionsPath: Zod.string().nullable().default(null)
		.describe('Path to the AGENTS.md instructions file for this agent. Relative to the .skilled_crew.yaml file. If null, the agent runs with no extra instructions beyond its skills.'),
	codeWorkerPath: Zod.string().nullable().default(null)
		.describe('Path to a deterministic code-worker module (.ts/.js), relative to the .skilled_crew.yaml file. When set, jobs assigned to this name run that module\'s exported entry function as plain code instead of instantiating an LLM agent — no model is ever created. Mutually exclusive with `instructionsPath`/`skills`. Use for steps whose logic is fully deterministic (e.g. an approval gate driving an irreversible action).'),
	mcp_servers: Zod.array(SkilledCrewYamlConfigMcpServerZod).default([])
		.describe('MCP servers exposed as tools to this agent. Each entry points to a JSON config file describing how to launch the server.'),
	skills: Zod.array(SkilledCrewYamlConfigSkillZod).default([])
		.describe('Skills available to this agent. Each skill becomes a callable sub-agent the orchestrator can hand work off to.'),
}).strict()
	.describe('Definition of one agent inside this skillet. The map key (e.g. `todo_list_agent`) is the agent name used when referring to it as `entryPointAgent` or in routing.');

const SkilledCrewYamlConfigScriptRuntimeZod = Zod.object({
	kind: Zod.enum(['local', 'container']).default('local')
		.describe('How skill scripts execute. `local`: run as child processes on the host (default, no isolation). `container`: build the Docker image from `dockerfile` and run scripts inside it (isolation + reproducible deps).'),
	dockerfile: Zod.string().nullable().default(null)
		.describe('Path to a Dockerfile, relative to the .skilled_crew.yaml file. Required when `kind` is `container`; ignored when `kind` is `local`.'),
}).strict()
	.describe('Where and how skill scripts execute. Defaults to local host execution.');

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export const SkilledCrewYamlConfigZod = Zod.object({
	version: Zod.string().default('1.0')
		.describe('Version of the .skilled_crew.yaml schema format. Currently `"1.0"`. Bumped when the schema gains breaking changes.'),
	id: Zod.string().default(`skillet-id-unspecified`)
		.describe('Stable identifier for this skillet. Used in session paths, cache keys, and cost tracking, so it should be unique across skillets you run on the same machine.'),
	commands: Zod.array(SkilledCrewYamlConfigCommandZod).default([])
		.describe('Slash commands the user can invoke during chat (e.g. typing `/french hello` triggers the `french` command). Each command maps to a `.command.md` file.'),
	entryPointAgent: Zod.string().nullable().default(null)
		.describe('Name of the agent that receives the user\'s messages first when multiple agents are defined. Must match a key in `agents`. If null and there are multiple agents, the first one wins; ignored when there is only one agent.'),
	agents: Zod.record(Zod.string(), SkilledCrewYamlConfigAgentZod).default({})
		.describe('Map of agent name → agent definition. Each key is the agent\'s name (referenced by `entryPointAgent`). The simplest skillets define one agent.'),
	script_runtime: SkilledCrewYamlConfigScriptRuntimeZod.default({ kind: 'local', dockerfile: null })
		.describe('Configures where and how skill scripts run. Defaults to `kind: local` (host child processes).'),
}).strict()
	.describe('Configuration for a skillet (an AI agent setup driven by markdown). Loaded from a `.skilled_crew.yaml` file by the skillet_agent CLI.');
