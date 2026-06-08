// node imports
import Path from "node:path";
import Fs from "node:fs";

// npm imports
import * as OpenAiAgents from '@openai/agents';
import ReadlinePromises from 'node:readline/promises'
import Chalk from 'chalk'

// local imports;
import { AgentRunner } from '../agent_runner/agent_runner';
import { AgentRunnerDriver } from '../agent_runner/agent_runner_driver';
import { AgentRunnerContext, AgentRunnerStepResult, AgentRunnerFinalResult, AgentRunnerConstants } from '../agent_runner/agent_runner_types';
import { MarkdownChalk } from "../libs/markdown_chalk";
import { TextSpinner } from "../libs/text_spinner";
import { SessionLogReader } from "../session/session_log_reader";
import type { SessionLogUserInput } from "../session/session_log_types";
import { SkilletPaths } from "../libs/skillet_paths";

export class CliChatHelper {

	/**
	 * Displays the session history for a given OpenAI session in the console, with color formatting to distinguish user and agent messages.
	 * This is called before starting a chat or running a task to provide context on the conversation history so far.
	 *
	 * @param openaiSession The OpenAI session object from which to retrieve and display the session history.
	 */
	static async sessionDisplayTty(openaiSession: OpenAiAgents.Session) {
		const sessionItems: OpenAiAgents.AgentInputItem[] = await openaiSession.getItems()

		console.log(Chalk.gray(`--- Displaying session history before starting chat ---`))

		// if there are no session items, display a message and return
		if (sessionItems.length === 0) {
			console.log(Chalk.gray(`(no session history)`))
			return
		}

		// display each session item with color formatting based on the role (user vs assistant)
		for (const item of sessionItems) {
			if (item.type !== 'message' && item.type !== undefined) continue;

			if (item.role === 'user') {
				let text: string;
				if (typeof item.content === 'string') {
					text = item.content;
				} else {
					// @ts-ignore
					const inputTextItem = item.content.find((contentItem) => contentItem.type === 'input_text');
					if (inputTextItem === null || inputTextItem === undefined) {
						continue;
					}
					text = inputTextItem.text;
				}
				console.log(`[${Chalk.green('user')}] ${text}`);
			} else if (item.role === 'assistant') {
				// @ts-ignore
				const outputTextItem = item.content.find((contentItem) => contentItem.type === 'output_text');
				if (outputTextItem === null || outputTextItem === undefined) {
					continue;
				}
				console.log(`[${Chalk.cyan('agent')}] ${outputTextItem.text}`);
			}
		}
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	displayTurn — single renderer for live chat AND JSONL replay. Consumes
	//	an AsyncGenerator<AgentRunnerStepResult, AgentRunnerFinalResult> (the
	//	exact shape produced by both AgentRunner.runOneShotAsyncGenerator and
	//	SessionLogReader.turnGenerator).
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	static async displayTurn(
		asyncGenerator: AsyncGenerator<AgentRunnerStepResult, AgentRunnerFinalResult>,
		{
			streamingEnabled,
			verboseLevel,
			textSpinner,
		}: {
			streamingEnabled: boolean,
			verboseLevel: number,
			textSpinner?: TextSpinner,
		}
	): Promise<AgentRunnerFinalResult> {
		let iterResult = await asyncGenerator.next();
		let streamingTextWritten = false;
		while (iterResult.done !== true) {
			const stepResult: AgentRunnerStepResult = iterResult.value;

			// If we were streaming text without a trailing newline, flush one before any event line
			if (streamingTextWritten === true && stepResult.type !== AgentRunnerConstants.EVENT.TEXT) {
				process.stdout.write('\n');
				streamingTextWritten = false;
			}

			// Display the intermediary result based on its type
			if (stepResult.type === AgentRunnerConstants.EVENT.AGENT_START) {
				if (verboseLevel > 0) console.log(`[${Chalk.magenta(stepResult.agentName)}][${Chalk.cyan('start')}] Agent start`)
			} else if (stepResult.type === AgentRunnerConstants.EVENT.AGENT_END) {
				if (verboseLevel > 0) console.log(`[${Chalk.magenta(stepResult.agentName)}][${Chalk.cyan('end')}] Agent end`)
			} else if (stepResult.type === AgentRunnerConstants.EVENT.AGENT_TOOL_START) {
				if (verboseLevel > 0) {
					let toolArgumentsStr: string = stepResult.toolArgumentsStr
					try {
						const parsed = JSON.parse(toolArgumentsStr)
						toolArgumentsStr = JSON.stringify(parsed, null, 4)
					} catch (err) {
						// keep as string if it can't be parsed as JSON
					}
					console.log(`[${Chalk.magenta(stepResult.agentName)}][${Chalk.cyan('tool')}] ${Chalk.cyan(stepResult.toolName)}(${toolArgumentsStr})`)
				}
			} else if (stepResult.type === AgentRunnerConstants.EVENT.AGENT_TOOL_END) {
				if (verboseLevel > 0) {
					let resultStr: string = stepResult.result
					try {
						const parsed = JSON.parse(resultStr)
						resultStr = JSON.stringify(parsed, null, 4)
					} catch (err) {
						// keep as string if it can't be parsed as JSON
					}
					console.log()
					console.log(`[${Chalk.magenta(stepResult.agentName)}][${Chalk.cyan('tool')}] ${Chalk.cyan(stepResult.toolName)}-> (${resultStr})`)
				}
			} else if (stepResult.type === AgentRunnerConstants.EVENT.HANDOFF) {
				if (verboseLevel > 0) console.log(`[${Chalk.magenta(stepResult.agentName)}][${Chalk.cyan('handoff')}] to ${Chalk.magenta(stepResult.toAgentName)}`)
			} else if (stepResult.type === AgentRunnerConstants.EVENT.TEXT) {
				if (textSpinner?.isSpinning() === true) textSpinner.stop()
				if (streamingEnabled === true) {
					process.stdout.write(stepResult.text);
					streamingTextWritten = true;
				}
			} else {
				// @ts-ignore
				throw new Error(`Received intermediary result of type ${stepResult.type} while streaming is disabled. streamingEnabled: ${streamingEnabled}, stepResult: ${JSON.stringify(stepResult)}`)
			}

			// goto next iteration
			iterResult = await asyncGenerator.next();

			// is it the last iteration? if so, the value is the final output, not an intermediary result, so break the loop
			if (iterResult.done === true) {
				break;
			}
		}

		// get the final output from the last value returned by the async generator
		const finalOutput: AgentRunnerFinalResult = iterResult.value;

		// flush a newline if streaming left the cursor mid-line
		if (streamingTextWritten === true) {
			process.stdout.write('\n');
			streamingTextWritten = false;
		}

		// stop the spinner (if it wasn't already stopped by streaming)
		if (textSpinner?.isSpinning() === true) textSpinner.stop()

		// display the response in colored markdown format (skip if streaming already printed it)
		if (streamingEnabled === false) {
			console.log(new MarkdownChalk().parse(finalOutput.text).trim())
		} else {
			console.log() // add a newline after streaming output
		}

		return finalOutput;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Replay a session from its JSONL log. Falls back to the SQLite-based
	//	text-only display when no log file exists (e.g. pre-logging sessions).
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	static async replaySessionTty(
		agentRunnerContext: AgentRunnerContext,
		{
			streamingEnabled,
			verboseLevel,
		}: {
			streamingEnabled: boolean,
			verboseLevel: number,
		}
	): Promise<void> {
		const filePath = agentRunnerContext.sessionLogWriter.filePath;
		const fileExists = await Fs.promises.access(filePath).then(() => true).catch(() => false);
		if (fileExists === false) {
			// no JSONL yet — fall back to the text-only SQLite history display
			await CliChatHelper.sessionDisplayTty(agentRunnerContext.agentSession);
			return;
		}

		console.log(Chalk.gray(`--- Replaying session log ---`))
		let turnCount = 0;
		for await (const turn of SessionLogReader.iterateTurns(filePath)) {
			turnCount++;
			const userInputText = CliChatHelper._formatUserInputToText(turn.userInput);
			console.log();
			console.log(`${Chalk.green('>> ')}${userInputText}`)
			console.log();

			const turnGenerator = SessionLogReader.turnGenerator(turn);
			await CliChatHelper.displayTurn(turnGenerator, {
				streamingEnabled,
				verboseLevel,
			});
		}
		if (turnCount === 0) {
			console.log(Chalk.gray(`(no session history)`))
		}
	}

	private static _formatUserInputToText(userInput: SessionLogUserInput): string {
		if (typeof userInput === 'string') return userInput;
		const parts: string[] = [];
		for (const item of userInput) {
			if (typeof item.content === 'string') {
				parts.push(item.content);
				continue;
			}
			for (const content of item.content) {
				if (content.type === 'input_text') {
					parts.push(content.text);
				} else if (content.type === 'input_image') {
					parts.push('[image]');
				} else if (content.type === 'input_file') {
					const filename = 'filename' in content ? (content.filename ?? '') : '';
					parts.push(`[file: ${filename}]`);
				}
			}
		}
		return parts.join(' ');
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Run chat
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	/**
	 * Runs an interactive or piped chat session with the agent.
	 *
	 * Handles both interactive (TTY) and non-interactive (piped) input modes.
	 * Maintains chat history using SQLite persistence and readline history.
	 * Displays agent events, tool calls, and streaming responses with color formatting.
	 *
	 * @param agentRunnerContext - The agent runner context containing agent configuration and state
	 * @param options - Optional configuration object
	 * @param options.streamingEnabled - Whether to enable streaming responses from the agent (default: false)
	 *
	 * @returns A promise that resolves when the chat session ends (via /exit command or EOF)
	 *
	 * @remarks
	 * - In interactive mode, prompts user with ">> " and maintains readline history
	 * - In piped mode, reads all input upfront to handle stream consumption properly
	 * - Supports special command "/exit" to exit the chat loop
	 * - Displays formatted output including agent events, tool calls, and final responses
	 * - Persists chat history to SQLite database for session continuity
	 * - Uses text spinner to indicate processing during non-streaming mode
	 *
	 * @example
	 * ```typescript
	 * const context = new AgentRunnerContext(config);
	 * await AgentRunner.runChat(context, { streamingEnabled: true });
	 * ```
	 */
	static async runChat(agentRunnerName: string, agentRunnerContext: AgentRunnerContext, {
		streamingEnabled = false,
		verboseLevel = 0,
	}: {
		streamingEnabled?: boolean,
		verboseLevel?: number,
	}): Promise<void> {
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Init readline
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const readlineHistoryPath = SkilletPaths.readlineHistory(agentRunnerName);
		let readlineHistory: string[] = []

		// test if the history file exists
		let historyFileExists = await Fs.promises.access(readlineHistoryPath).then(() => true).catch(() => false)
		if (historyFileExists === true) {
			const fileContent = await Fs.promises.readFile(readlineHistoryPath, 'utf-8')
			readlineHistory = JSON.parse(fileContent)
		}

		// init readline
		const readline = ReadlinePromises.createInterface({
			input: process.stdin,
			output: process.stdout,
			history: readlineHistory
		})

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Handle piped input
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const isInteractive = process.stdin.isTTY === true ? true : false;
		// When stdin is piped, collect all lines upfront because readline.question()
		// loses lines — the pipe is consumed immediately but question() only captures
		// one line per call, and the stream closes before the next async call completes.
		// Usage:
		//   echo -e "hello\nworld\n/exit" | skillmd-runner -a ./agent_folder
		let pipedLines: string[] = [];
		let pipedIndex = 0;
		if (isInteractive === false) {
			for await (const line of readline) {
				pipedLines.push(line);
			}
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Chat loop
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		// init text spinner - to show a spinner while waiting for the api response
		const textSpinner = new TextSpinner()

		while (true) {
			let userInput: string;

			// get user input either from the piped lines or from the readline prompt
			if (isInteractive === false) {
				// non-interactive mode: read from pre-collected lines
				if (pipedIndex >= pipedLines.length) break;
				userInput = pipedLines[pipedIndex];
				pipedIndex++;
				console.log()
				console.log(`${Chalk.green('>> ')}${userInput}`)
				console.log()
			} else {
				// interactive mode: prompt the user
				console.log()
				userInput = await readline.question(Chalk.green('>> '))
			}
			userInput = userInput.trim()

			// if userInput is empty, skip
			if (userInput === '') continue

			if (userInput.toLowerCase() === '/exit') {
				break;
			}

			///////////////////////////////////////////////////////////////////////////////
			///////////////////////////////////////////////////////////////////////////////
			//	Run the agent on the user input and get the response
			///////////////////////////////////////////////////////////////////////////////
			///////////////////////////////////////////////////////////////////////////////

			// display a spinner
			if (isInteractive) textSpinner.start()

			// Build the async generator for the agent response and hand it to
			// the shared displayTurn helper — same renderer is used for replay.
			const asyncGenerator = AgentRunner.runOneShotAsyncGenerator(agentRunnerContext, userInput, {
				streamingEnabled: streamingEnabled,
			});

			await CliChatHelper.displayTurn(asyncGenerator, {
				streamingEnabled,
				verboseLevel,
				textSpinner,
			});
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	handle exit
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// display exit message
		console.log('Bye.')

		// close readline
		readline.close()

		// save readline history
		// @ts-ignore
		await Fs.promises.writeFile(readlineHistoryPath, JSON.stringify(readline.history, null, '\t'), 'utf-8')
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Run one-shot task
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	static async runOneShot(roleAgentContext: AgentRunnerContext, userInput: string, {
		verboseLevel = 0,
		streamingEnabled = false,
	}: {
		verboseLevel?: number,
		streamingEnabled?: boolean,
	}): Promise<void> {
		// Delegate to the headless driver so the job/workflow worker and the CLI
		// share one one-shot run loop (and the same #220 dispatcher-log format).
		await AgentRunnerDriver.runOneShot(roleAgentContext, userInput, {
			verboseLevel,
			streamingEnabled,
		});
	}
}
