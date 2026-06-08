// node imports
import Path from 'path';

// npm imports
import * as OpenAiAgents from '@openai/agents';
import Chalk from 'chalk'
import Assert from 'assert';

// local imports
import { CommandDoc } from '../config/command/command_types';
import { CommandConfigHelper } from '../config/command/command_config_helper';
import { AgentRunnerContext, ExternalCommandResult } from './agent_runner_types';
import {
	AgentRunnerStepResult,
	AgentRunnerStepResultAgentStart,
	AgentRunnerStepResultAgentEnd,
	AgentRunnerStepResultToolEnd,
	AgentRunnerStepResultToolStart,
	AgentRunnerStepResultHandoff,
	AgentRunnerStepResultText,
	AgentRunnerFinalResult,
	AgentRunnerConstants,
} from './agent_runner_types';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	AgentRunner
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class AgentRunner {

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	static async *runOneShotAsyncGenerator(roleAgentContext: AgentRunnerContext, userInput: string | OpenAiAgents.protocol.UserMessageItem[], {
		streamingEnabled = false,
	}: {
		commandDocs?: CommandDoc[],
		mcpServers?: OpenAiAgents.MCPServer[],
		agentSession?: OpenAiAgents.Session,
		streamingEnabled?: boolean,
	} = {}): AsyncGenerator<AgentRunnerStepResult, AgentRunnerFinalResult> {

		// Persist the turn's user_message entry to the JSONL log so replay gets a
		// clean turn boundary. Done before any slash-command normalization so the
		// log reflects what the user actually typed.
		await roleAgentContext.sessionLogWriter.appendUserMessage(userInput);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Handle slash commands and command aliases (only for string input)
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		if (typeof userInput === 'string') {
			// command alias
			if (userInput.trim() === '?') {
				userInput = '/help';
			}

			// handle slash commands (both internal and external)
			if (userInput.startsWith('/')) {
				const internalOutput = await AgentRunner._handleSlashCommandInternal(roleAgentContext, userInput);
				if (internalOutput !== null) {
					const stepResult: AgentRunnerStepResultText = {
						type: 'text',
						text: internalOutput,
					};
					void roleAgentContext.sessionLogWriter.appendStep(stepResult);
					yield stepResult;
					const finalResult: AgentRunnerFinalResult = { text: internalOutput };
					await roleAgentContext.sessionLogWriter.appendFinalResult(finalResult, { model: roleAgentContext.modelSpec });
					return finalResult;
				}

				const result = await AgentRunner._handleSlashCommandExternal(roleAgentContext, userInput);
				if (result.kind === 'final') {
					const stepResult: AgentRunnerStepResultText = {
						type: 'text',
						text: result.text,
					};
					void roleAgentContext.sessionLogWriter.appendStep(stepResult);
					yield stepResult;
					const finalResult: AgentRunnerFinalResult = result.jobIds !== undefined
						? { text: result.text, jobIds: result.jobIds }
						: { text: result.text };
					await roleAgentContext.sessionLogWriter.appendFinalResult(finalResult, { model: roleAgentContext.modelSpec });
					return finalResult;
				}
				userInput = result.userInput;
			}
		}

		if (streamingEnabled === false) {
			return yield* AgentRunner._runNonStreaming(roleAgentContext, userInput);
		}

		return yield* AgentRunner._runStreaming(roleAgentContext, userInput);
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Non Streaming mode
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static async *_runNonStreaming(
		roleAgentContext: AgentRunnerContext,
		userInput: string | OpenAiAgents.protocol.UserMessageItem[],
	): AsyncGenerator<AgentRunnerStepResult, AgentRunnerFinalResult> {
		// Shared queue + notify pattern so events are yielded as they arrive
		const stepResultQueue: AgentRunnerStepResult[] = [];
		const queueNotifyFn = { resolveFn: null as (() => void) | null };

		function stepResultEnqueue(result: AgentRunnerStepResult): void {
			// Fire-and-forget: writer serializes internally via a promise chain,
			// so concurrent appends stay ordered without slowing the event pump.
			void roleAgentContext.sessionLogWriter.appendStep(result);
			stepResultQueue.push(result);
			if (queueNotifyFn.resolveFn !== null) {
				const oldNotifyFn = queueNotifyFn.resolveFn;
				queueNotifyFn.resolveFn = null;
				oldNotifyFn();
			}
		}

		function waitForStepResult(): Promise<void> {
			if (stepResultQueue.length > 0) {
				return Promise.resolve();
			}
			return new Promise<void>((resolve) => {
				queueNotifyFn.resolveFn = resolve;
			});
		}

		// Bind event listeners on EVERY agent reachable from the entry agent's
		// handoff graph (not just the direct handoffs) — skill agents like
		// gather-sources, blackboard, publish-brief are handoffs of the worker
		// role agents, two hops from the entry agent. Without recursive binding
		// their tool_start/tool_end events are silently dropped, making the
		// verbose log show "[research_agent][handoff] to gather-sources" followed
		// by raw JSON output instead of the expected "[gather-sources][tool]
		// run_command_line(...)" trace.
		const unregisterFns: (() => Promise<void>)[] = [];
		for (const agent of AgentRunner._collectAgentsReachable(roleAgentContext.entryAgent)) {
			unregisterFns.push(await AgentRunner._bindAgentEvent(agent, stepResultEnqueue));
		}

		// run the agent without awaiting inline, so the generator can yield events as they arrive
		let runDone = false;
		const runPromise = OpenAiAgents.run(roleAgentContext.entryAgent, userInput, {
			session: roleAgentContext.agentSession,
			// SDK default is 10 turns; multi-role-agent skillets (e.g. daily intel
			// brief: orchestrator → 3 workers × handoffs+tool+per-cluster writes)
			// can easily need 30+. Defaults to 50 (a generous ceiling that bounds
			// runaway loops); lower it via SKILLET_MAX_TURNS to cap dev cost (#193).
			maxTurns: roleAgentContext.maxTurns,
		}).then((result) => {
			runDone = true;
			// wake the generator so it can exit the loop
			if (queueNotifyFn.resolveFn !== null) {
				const oldNotifyFn = queueNotifyFn.resolveFn;
				queueNotifyFn.resolveFn = null;
				oldNotifyFn();
			}
			return result;
		});

		// yield from the queue as events arrive
		while (runDone === false || stepResultQueue.length > 0) {
			await waitForStepResult();
			while (stepResultQueue.length > 0) {
				yield stepResultQueue.shift()!;
			}
		}

		// await the run promise to get the final output
		const result = await runPromise;
		const finalResponse = result.finalOutput?.trim() ?? '[no response]';

		// emit the final text as a step result so callers receive it uniformly across streaming and non-streaming modes
		stepResultEnqueue({
			type: AgentRunnerConstants.EVENT.TEXT,
			text: finalResponse,
		} as AgentRunnerStepResultText);

		while (stepResultQueue.length > 0) {
			yield stepResultQueue.shift()!;
		}

		// unregister event listeners to clean up
		for (const unregisterFn of unregisterFns) {
			await unregisterFn();
		}

		// return the final result
		const finalResult: AgentRunnerFinalResult = { text: finalResponse };
		await roleAgentContext.sessionLogWriter.appendFinalResult(finalResult, { model: roleAgentContext.modelSpec });
		return finalResult;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Streaming mode
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static async *_runStreaming(
		roleAgentContext: AgentRunnerContext,
		userInput: string | OpenAiAgents.protocol.UserMessageItem[],
	): AsyncGenerator<AgentRunnerStepResult, AgentRunnerFinalResult> {
		// Shared channel: both events and text chunks push here, with a notify mechanism so the generator wakes on whichever arrives first.
		const stepResultQueue: AgentRunnerStepResult[] = [];
		const queueNotifyFn = { resolveFn: null as (() => void) | null };

		function stepResultEnqueue(result: AgentRunnerStepResult): void {
			// Fire-and-forget: writer serializes internally via a promise chain,
			// so concurrent appends stay ordered without slowing the event pump.
			void roleAgentContext.sessionLogWriter.appendStep(result);
			stepResultQueue.push(result);
			if (queueNotifyFn.resolveFn !== null) {
				const oldNotifyFn = queueNotifyFn.resolveFn;
				queueNotifyFn.resolveFn = null;
				oldNotifyFn();
			}
		}

		function waitForStepResult(): Promise<void> {
			if (stepResultQueue.length > 0) {
				return Promise.resolve();
			}
			return new Promise<void>((resolve) => {
				queueNotifyFn.resolveFn = resolve;
			});
		}

		// Bind the event listeners and get the unregister functions so we can stop listening to events at the end of the run
		const unregisterFns: (() => Promise<void>)[] = [];
		for (const agent of AgentRunner._collectAgentsReachable(roleAgentContext.entryAgent)) {
			unregisterFns.push(await AgentRunner._bindAgentEvent(agent, stepResultEnqueue));
		}

		// run the agent with streaming enabled
		const streamedResult = await OpenAiAgents.run(roleAgentContext.entryAgent, userInput, {
			session: roleAgentContext.agentSession,
			stream: true,
			maxTurns: roleAgentContext.maxTurns,
		});

		// Consume the text stream in the background, pushing chunks
		// into the same channel that events use. This way the generator
		// wakes on whichever source produces data first.
		let streamDone = false;
		const textStream = streamedResult.toTextStream({
			compatibleWithNodeStreams: true
		});
		const textStreamConsumerPromise = (async () => {
			for await (const chunk of textStream) {
				stepResultEnqueue({
					type: AgentRunnerConstants.EVENT.TEXT,
					text: chunk.toString(),
				} as AgentRunnerStepResultText);
			}
			// mark the stream as done, so the generator can exit once all events and chunks have been processed
			streamDone = true;
			// Wake the generator so it can exit the loop
			if (queueNotifyFn.resolveFn !== null) {
				const oldResolveFn = queueNotifyFn.resolveFn;
				queueNotifyFn.resolveFn = null;
				oldResolveFn();
			}
		})();

		// Yield from the channel as items arrive — events and text
		// chunks are delivered with zero added latency.
		while (streamDone === false || stepResultQueue.length > 0) {
			await waitForStepResult();
			while (stepResultQueue.length > 0) {
				yield stepResultQueue.shift()!;
			}
		}

		// sanity check
		Assert.ok(streamDone === true, 'Expected streamDone to be true after exiting loop');
		Assert.ok(stepResultQueue.length === 0, 'Expected stepResultQueue to be empty after exiting loop');

		// wait for the text stream consumer to finish
		await textStreamConsumerPromise;

		// stop listening to events
		for (const unregisterFn of unregisterFns) {
			await unregisterFn();
		}

		// get the final output after the stream is done
		const finalOutput = streamedResult.finalOutput?.trim() ?? '[no response]';

		// return the final result
		const finalResult: AgentRunnerFinalResult = { text: finalOutput };
		await roleAgentContext.sessionLogWriter.appendFinalResult(finalResult, { model: roleAgentContext.modelSpec });
		return finalResult;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Handle internal slash commands
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	/**
	 * Bind agent events and push them into the intermediary result channel, so they can be yielded by the generator. 
	 * Returns a function to unregister the event listeners when the run is done.
	 * 
	 * @param agent The agent whose events to listen to
	 * @param stepResultEnqueue The function to push intermediary results into the channel that the generator yields from
	 * @returns A function that unregisters the event listeners when called, to be used at the end of the run to clean up event 
	 * listeners and avoid potential memory leaks or unwanted behavior in subsequent runs
	 */
	private static async _bindAgentEvent(
		agent: OpenAiAgents.Agent,
		stepResultEnqueue: (result: AgentRunnerStepResult) => void
	): Promise<() => Promise<void>> {
		// start listening on events
		function onAgentStart(runContext: OpenAiAgents.RunContext) {
			stepResultEnqueue({
				type: AgentRunnerConstants.EVENT.AGENT_START,
				agentName: agent.name,
			} as AgentRunnerStepResultAgentStart);
		}
		function onAgentEnd(runContext: OpenAiAgents.RunContext) {
			stepResultEnqueue({
				type: AgentRunnerConstants.EVENT.AGENT_END,
				agentName: agent.name,
			} as AgentRunnerStepResultAgentEnd);
		}
		function onAgentToolStart(runContext: OpenAiAgents.RunContext, tool: OpenAiAgents.Tool, details: {
			toolCall: OpenAiAgents.protocol.ToolCallItem;
		}) {
			const toolArguments = details.toolCall.type === 'function_call' ? details.toolCall.arguments : '[no clue]'
			stepResultEnqueue({
				type: AgentRunnerConstants.EVENT.AGENT_TOOL_START,
				agentName: agent.name,
				toolName: `${tool.name}`,
				toolArgumentsStr: toolArguments
			} as AgentRunnerStepResultToolStart);
		}
		function onAgentToolEnd(runContext: OpenAiAgents.RunContext, tool: OpenAiAgents.Tool, result: string, details: {
			toolCall: OpenAiAgents.protocol.ToolCallItem;
		}) {
			stepResultEnqueue({
				type: AgentRunnerConstants.EVENT.AGENT_TOOL_END,
				agentName: agent.name,
				toolName: `${tool.name}`,
				result: result,
			} as AgentRunnerStepResultToolEnd);
		}
		function onAgentHandoff(runContext: OpenAiAgents.RunContext, nextAgent: OpenAiAgents.Agent) {
			stepResultEnqueue({
				type: AgentRunnerConstants.EVENT.HANDOFF,
				agentName: agent.name,
				toAgentName: nextAgent.name
			} as AgentRunnerStepResultHandoff);
		}
		agent.on('agent_start', onAgentStart)
		agent.on('agent_end', onAgentEnd)
		agent.on('agent_tool_start', onAgentToolStart)
		agent.on('agent_tool_end', onAgentToolEnd)
		agent.on('agent_handoff', onAgentHandoff)


		async function unregisterEventListeners() {
			// stop listening to events
			agent.off('agent_start', onAgentStart)
			agent.off('agent_end', onAgentEnd)
			agent.off('agent_tool_start', onAgentToolStart)
			agent.off('agent_tool_end', onAgentToolEnd)
			agent.off('agent_handoff', onAgentHandoff)
		}
		return unregisterEventListeners
	}

	/**
	 * Walk the handoff graph from `startAgent` and return every reachable agent
	 * once. Used to bind step-event listeners on the whole tree (entry agent →
	 * worker role agents → skill agents) so events from deep skill agents are
	 * not silently dropped. Handles cycles (e.g. research ⇄ orchestrator).
	 *
	 * @param startAgent The agent to start walking from (typically the entry agent).
	 * @returns Array of every unique agent reachable via handoff edges.
	 */
	private static _collectAgentsReachable(startAgent: OpenAiAgents.Agent): OpenAiAgents.Agent[] {
		const visited = new Set<OpenAiAgents.Agent>();
		const queue: OpenAiAgents.Agent[] = [startAgent];
		while (queue.length > 0) {
			const current = queue.shift() as OpenAiAgents.Agent;
			if (visited.has(current) === true) {
				continue;
			}
			visited.add(current);
			for (const handoff of current.handoffs) {
				const target: OpenAiAgents.Agent = handoff instanceof OpenAiAgents.Handoff ? handoff.agent : handoff;
				if (visited.has(target) === false) {
					queue.push(target);
				}
			}
		}
		return Array.from(visited);
	}

	/**
	 * Handles a slash command input that is built into the system (e.g. /help, /skills, /mcp_servers).
	 * Returns the response string to send back to the user, or null if the input is not a slash command.
	 * @param userInput The raw user input string
	 * @param roleAgentContext The context object containing the agent, command docs, MCP servers, etc. that may be needed to resolve the command
	 * @returns The response string to send back to the user, or null if the command was not recognized as an internal slash command 
	 */
	private static async _handleSlashCommandInternal(roleAgentContext: AgentRunnerContext, userInput: string): Promise<string | null> {
		// return null if the input is not a slash command
		if (userInput.startsWith('/') === false) {
			return null;
		}

		const commandName = userInput.split(' ')[0];

		if (commandName === '/help') {
			let outputStr = '# Available commands:\n';
			outputStr += `- **/help** Show this help message.\n`;
			outputStr += `- **/mcp_servers** Show the list of mcp server and their tools.\n`;
			outputStr += `- **/skills** Show the list of skills.\n`;
			outputStr += `- **/compact** Force a compaction of the current session now.\n`;
			outputStr += `- **/compact info** Show the current session size and compaction settings.\n`;
			for (const externalCommand of roleAgentContext.extensions?.externalSlashCommands ?? []) {
				outputStr += `- **/${externalCommand.name}** ${externalCommand.description}\n`;
			}
			outputStr += `- **/exit** exit the chat.\n`;
			outputStr += `\n`;
			outputStr += `## Custom commands\n`;
			for (const commandDoc of roleAgentContext.commandDocs) {
				const commandName = Path.basename(commandDoc.filePath, CommandConfigHelper.COMMAND_EXTENSION);
				outputStr += `- **/${commandName}** ${commandDoc.header.description}\n`;
			}
			if (roleAgentContext.commandDocs.length === 0) {
				outputStr += '[no custom prompt files found]\n';
			}
			return outputStr;
		} else if (commandName === '/mcp_servers') {
			let outputStr = '# Available MCP servers:\n';
			for (const mcpServer of roleAgentContext.mcpServers) {
				outputStr += `## ${mcpServer.name}\n`;
				const mcpTools = await mcpServer.listTools();
				for (const mcpTool of mcpTools) {
					outputStr += `- **${mcpTool.name}**: ${mcpTool.description}\n`;
				}
			}
			if (roleAgentContext.mcpServers.length === 0) {
				outputStr += `[no MCP servers configured]\n`;
			}
			return outputStr;
		} else if (commandName === '/compact') {
			const args = userInput.slice('/compact'.length).trim();
			const items = await roleAgentContext.agentSession.getItems();
			if (args === 'info') {
				let outputStr = '# Session compaction info\n';
				outputStr += `- items: ${items.length}\n`;
				outputStr += `- threshold (non-user items): ${roleAgentContext.compactThreshold}\n`;
				outputStr += `- mode: previous_response_id\n`;
				return outputStr;
			}
			if (args !== '') {
				return `Unknown arguments for /compact: **${args}**. Usage: /compact or /compact info`;
			}
			const before = items.length;
			const result = await roleAgentContext.agentSession.runCompaction({
				compactionMode: 'input',
				force: true,
			});
			const after = (await roleAgentContext.agentSession.getItems()).length;
			if (result === null) {
				return `Nothing to compact (${before} items).`;
			}
			return `Compacted session: ${before} → ${after} items.`;
		} else if (commandName === '/skills') {
			let outputStr = '# Available skills:\n';
			for (const handoff of roleAgentContext.entryAgent.handoffs) {
				if (handoff instanceof OpenAiAgents.Handoff) {
					outputStr += `- **${handoff.agentName}**: ${handoff.toolDescription}\n`;
				} else {
					Assert.ok(false, 'Expected handoff to be an instance of OpenAiAgents.Handoff');
				}
			}
			if (roleAgentContext.entryAgent.handoffs.length === 0) {
				outputStr += `[no skills found in agent folder]\n`;
			}
			return outputStr;
		}

		// External slash commands injected by a higher layer (e.g. /jobs /show
		// /comment /unblock supplied by the workflow orchestrator). The base
		// runner knows nothing about them — it just dispatches by name.
		const externalSlashCommand = (roleAgentContext.extensions?.externalSlashCommands ?? [])
			.find((command) => `/${command.name}` === commandName);
		if (externalSlashCommand !== undefined) {
			const argsText = userInput.slice(commandName.length).trim();
			return await externalSlashCommand.handler(roleAgentContext, argsText);
		}

		return null;

	}

	/**
	 * Handles a slash command input. Returns the resolved prompt string to send to the agent,
	 * or null if the command was handled internally (no agent call needed).
	 * @param userInput The raw user input string
	 * @param roleAgentContext The context object containing the agent, command docs, MCP servers, etc. that may be needed to resolve the command
	 * @returns The resolved prompt string to send to the agent, or null if the command was not recognized as an external slash command
	 */
	private static async _handleSlashCommandExternal(
		roleAgentContext: AgentRunnerContext,
		userInput: string,
	): Promise<ExternalCommandResult> {

		if (userInput.startsWith('/') === false) {
			throw new Error(`Expected userInput to start with '/', got: ${userInput}`);
		}

		const spaceIdx = userInput.indexOf(' ');
		const commandName = spaceIdx === -1 ? userInput.slice(1) : userInput.slice(1, spaceIdx);
		const argsText = spaceIdx === -1 ? '' : userInput.slice(spaceIdx + 1).trim();

		const commandDoc = roleAgentContext.commandDocs.find(commandDoc => {
			const docCommandName = Path.basename(commandDoc.filePath, CommandConfigHelper.COMMAND_EXTENSION);
			return docCommandName === commandName;
		})
		if (commandDoc === undefined) {
			const outputStr = `Unknown command: **${commandName}**. Type /help to list commands.`
			console.log(`${Chalk.red(outputStr)}`)
			return { kind: 'final', text: outputStr };
		}

		// A non-chat lane (e.g. `lane: 'job'`) short-circuits the agent: an
		// injected router instantiates the command and returns its own final
		// response. The base runner stays lane-agnostic; with no router injected
		// it returns a clear message instead of crashing.
		if (commandDoc.header.lane !== undefined && commandDoc.header.lane !== 'chat') {
			const laneCommandRouter = roleAgentContext.extensions?.laneCommandRouter;
			const routed = laneCommandRouter !== undefined && laneCommandRouter !== null
				? laneCommandRouter(roleAgentContext, commandDoc, argsText)
				: null;
			if (routed !== null) {
				return routed;
			}
			return {
				kind: 'final',
				text: `This command targets the '${commandDoc.header.lane}' lane; run it via the skilled_workflow CLI.`,
			};
		}

		let resolvedInput = commandDoc.content.replace(/\$ARGUMENTS/g, argsText);
		if (commandDoc.header.agent) {
			resolvedInput = `[Use the ${commandDoc.header.agent} agent]\n${resolvedInput} `;
		}
		return { kind: 'forward', userInput: resolvedInput };
	}
}
