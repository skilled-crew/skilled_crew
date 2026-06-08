#!/usr/bin/env node

// node imports
import Path from 'node:path';
import { fileURLToPath } from 'node:url';

// npm imports
import * as Commander from 'commander';

// Load environment variables (e.g. OPENAI_API_KEY). First resolve a .env next to
// this file rather than cwd — when run as a job-lane worker the dispatcher spawns
// us with a workspace cwd, so dotenv would otherwise miss the project's .env
// entirely. Then fall back to the current working directory's .env so that
// `npx skilled_crew` users can drop a .env next to where they run. dotenv never
// overrides already-set vars, so real process env and the file-relative .env keep
// precedence over the cwd fallback.
import dotenv from 'dotenv';
const CLI_FILE_DIR = Path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = Path.resolve(CLI_FILE_DIR, '..', '.env');
dotenv.config({ quiet: true, path: ENV_PATH });
dotenv.config({ quiet: true });

// local imports
import { AgentRunnerInit } from './agent_runner/agent_runner_init';
import { CliChatHelper } from './commands/cli_chat_helper';
import { CliEvalHelper } from './commands/cli_eval_helper';
import { CliLogHelper } from './commands/cli_log_helper';
import { CliSchemaHelper } from './commands/cli_schema_helper';
import { CliUserHelper } from './commands/cli_user_helper';
import { UserStore } from './libs/user_store';
import { CrewResolver } from './libs/crew_resolver';
import { UtilsAi } from './libs/utils_ai';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

type ChatRunSubCmdOptions = {
	skilledCrewYamlConfigPath: string;
	verboseLevel: number;
	stream: boolean;
	userEmail: string;
	sessionName: string;
};

type EvalRunSubCmdOptions = {
	skilledCrewYamlConfigPath: string;
	evalFolderPath: string;
	verboseLevel: number;
};

type EvalGradeSubCmdOptions = {
	evalFolderPath: string;
};

type LogStreamSubCmdOptions = {
	logsDir?: string;
};

function sharedAgentRunOptions(command: Commander.Command): Commander.Command {
	const defaultSessionName = `session_${new Date().toISOString()}_${Math.random().toString(16).slice(2)}`;
	return command
		.option('-c, --skilled-crew-yaml-config-path <pathOrId>',
			'path to a .skilled_crew.yaml file, or the skilletId of a bundled/user crew (default: todo_list)',
			CrewResolver.DEFAULT_SKILLET_ID)
		.option('-v, --verbose-level', 'increase verbosity (repeatable)', (_, previous: number) => previous + 1, 0)
		.option('-s, --stream', 'stream response tokens as they arrive instead of waiting for the full response', false)
		.option('--user-email <email>',
			'email of the user for session management; must exist in the user store',
			UserStore.DEFAULT_USER_EMAIL)
		.option('--session-name <sessionName>',
			'session name for session management (default: "default_session")',
			defaultSessionName);
}

/**
 * Resolve a `--user-email` value to the session userId, verifying the user
 * exists in the shared user store. The email IS the userId (one identity shared
 * with the web client). Seeds the default user first so a fresh checkout works
 * on its first run (issue #261); still exits with an error if a non-default
 * email is requested but absent.
 */
async function resolveUserIdFromEmail(userEmail: string): Promise<string> {
	await CliUserHelper.ensureDefaultUser();
	return CliUserHelper.requireUserByEmail(userEmail).email;
}

/**
 * Fail fast when SKILLET_MODEL_RUNNER points at a provider this process cannot
 * reach — no OPENAI_API_KEY, or a local lmstudio/ollama server that is not
 * running. Prints an actionable message and exits 1 rather than letting the run
 * die deep inside the first model call (#265). A no-op when the variable is unset.
 */
async function assertModelRunnerRunnableOrExit(): Promise<void> {
	const problem = await UtilsAi.checkModelRunnerRunnable();
	if (problem !== null) {
		console.error(problem);
		process.exit(1);
	}
}

async function main() {
	const program = new Commander.Command();
	program
		.description([
			`skilled_crew — AI agent orchestration engine driven by Markdown.`,
			``,
			`Point it at an 'agent folder' containing an AGENTS.md orchestrator`,
			`and one or more skills/ subdirectories, each with a SKILL.md file.`,
			`Each skill becomes an OpenAI tool-calling sub-agent; the orchestrator`,
			`routes your messages to the right skill automatically.`,
			``,
			`MCP servers are supported via -c, giving agents access to external tools.`,
			`API responses are cached locally in SQLite to save tokens on retries.`,
			``,
			`Spec and documentation: https://www.mdskills.ai/specs`,
		].join(`\n`));

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	chat
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	sharedAgentRunOptions(program
		.command('chat')
		.description('start an interactive chat REPL with the agent')
	).action(async (_opts: unknown, cmd: Commander.Command) => {
		await assertModelRunnerRunnableOrExit();
		const options = cmd.optsWithGlobals() as ChatRunSubCmdOptions;
		const skilledCrewYamlConfigPath = CrewResolver.resolve(options.skilledCrewYamlConfigPath);
		const userId = await resolveUserIdFromEmail(options.userEmail);
		// create the agent runner context
		const agentRunnerContext = await AgentRunnerInit.createAgentRunnerContext({
			skilledCrewYamlConfigPath: skilledCrewYamlConfigPath,
			verboseLevel: options.verboseLevel,
			userId: userId,
			sessionName: options.sessionName,
		});

		// display a starting message with the session and user info
		console.log(`Starting chat session "${options.sessionName}" for user "${userId}" with agent config "${skilledCrewYamlConfigPath}"`);

		// display the current session history before starting the chat, so that the user can see the context of the conversation so far
		console.log();
		await CliChatHelper.replaySessionTty(agentRunnerContext, {
			streamingEnabled: options.stream,
			verboseLevel: options.verboseLevel,
		});

		const agentRunnerName = Path.basename(skilledCrewYamlConfigPath, '.skilled_crew.yaml');

		// run the chat loop
		await CliChatHelper.runChat(agentRunnerName, agentRunnerContext, {
			streamingEnabled: options.stream,
			verboseLevel: options.verboseLevel,
		});

		// Close all MCP server connections after the chat session ends
		for (const mcpServer of agentRunnerContext.mcpServers) {
			await mcpServer.close();
		}
	});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	run
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	sharedAgentRunOptions(program
		.command('run')
		.description('run a single one-shot task and exit')
		.argument('<task>', 'the task to run')
	).action(async (task: string, _opts: unknown, cmd: Commander.Command) => {
		await assertModelRunnerRunnableOrExit();
		const options = cmd.optsWithGlobals() as ChatRunSubCmdOptions;
		const skilledCrewYamlConfigPath = CrewResolver.resolve(options.skilledCrewYamlConfigPath);
		const userId = await resolveUserIdFromEmail(options.userEmail);

		console.log(`cli run for user "${userId}" with agent config "${skilledCrewYamlConfigPath}"`);

		// create the agent runner context
		const agentRunnerContext = await AgentRunnerInit.createAgentRunnerContext({
			skilledCrewYamlConfigPath: skilledCrewYamlConfigPath,
			verboseLevel: options.verboseLevel,
			userId: userId,
			sessionName: options.sessionName,
		});

		// Display the current session history before running the task, so the user
		// can see the context the task runs in.
		await CliChatHelper.replaySessionTty(agentRunnerContext, {
			streamingEnabled: options.stream,
			verboseLevel: options.verboseLevel,
		});

		// run the task
		await CliChatHelper.runOneShot(agentRunnerContext, task, {
			streamingEnabled: options.stream,
		});

		// Close all MCP server connections after the task is done
		for (const mcpServer of agentRunnerContext.mcpServers) {
			await mcpServer.close();
		}
	});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	list
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	program
		.command('list')
		.description('list the skilletId of every bundled and user crew that -c can resolve by id')
		.action(() => {
			const crews = CrewResolver.listAvailable();
			if (crews.length === 0) {
				console.log('no crews found');
				return;
			}
			for (const crew of [...crews].sort((crewA, crewB) => crewA.id.localeCompare(crewB.id))) {
				console.log(`${crew.id}\t${crew.path}`);
			}
		});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	eval_run
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	program
		.command('eval_run')
		.description('Run all evals from an eval folder against an agent configuration')
		.requiredOption('-c, --skilled-crew-yaml-config-path <path>', 'path to the .skilled_crew.yaml config file')
		.requiredOption('-f, --eval-folder-path <path>', 'path to the eval folder containing evals.json')
		.option('-v, --verbose-level', 'increase verbosity (repeatable)', (_: unknown, previous: number) => previous + 1, 0)
		.action(async (_opts: unknown, cmd: Commander.Command) => {
			await assertModelRunnerRunnableOrExit();
			const options = cmd.optsWithGlobals() as EvalRunSubCmdOptions;
			await CliEvalHelper.run(options);
		});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	eval_grade
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	program
		.command('eval_grade')
		.description('Grade eval run results using LLM-as-a-judge')
		.requiredOption('-f, --eval-folder-path <path>', 'path to the eval folder containing evals.json and evals_output/')
		.action(async (_opts: unknown, cmd: Commander.Command) => {
			const options = cmd.optsWithGlobals() as EvalGradeSubCmdOptions;
			await CliEvalHelper.grade(options);
		});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	log stream
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	const logCommand = program
		.command('log')
		.description('inspect session logs under the agent state dir (.skilled-agent/state/.agent_session_logs in a checkout, or the XDG state dir when installed)');

	logCommand
		.command('stream')
		.description('print existing user/agent turns from session logs, then tail for new ones')
		.option('--logs-dir <path>', 'override the session-logs root directory')
		.action(async (_opts: unknown, cmd: Commander.Command) => {
			const options = cmd.optsWithGlobals() as LogStreamSubCmdOptions;
			await CliLogHelper.stream({ logsDirPath: options.logsDir });
		});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	schema_generate
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	program
		.command('schema_generate')
		.description('generate the JSON schema for .skilled_crew.yaml files from its Zod source')
		.action(async () => {
			await CliSchemaHelper.generate();
		});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	schema_check
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	program
		.command('schema_check')
		.description('verify the committed JSON schemas match their Zod sources; exits non-zero if out of sync')
		.action(async () => {
			await CliSchemaHelper.check();
		});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	postinstall
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	// TEMPORARY (issue #261): invoked from the package's npm `postinstall` hook so
	// a fresh install has the default user ready on first run. Most users do not
	// realise the agent is multi-user, so this gives them a usable identity without
	// a manual seed step. Remove once real onboarding exists.
	program
		.command('postinstall')
		.description('seed the default user so a fresh install works on first run (temporary, issue #261)')
		.action(async () => {
			await CliUserHelper.ensureDefaultUser();
		});

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	await program.parseAsync(process.argv);

	process.exit(process.exitCode ?? 0);
}

main().catch(console.error);
