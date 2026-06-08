// npm imports
import Chalk from 'chalk';

// local imports
import { AgentRunner } from './agent_runner';
import { AgentRunnerContext, AgentRunnerStepResult } from './agent_runner_types';
import { MarkdownChalk } from '../libs/markdown_chalk';
import { TextSpinner } from '../libs/text_spinner';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	AgentRunnerDriver — headless one-shot run loop.
//
//	Drives `AgentRunner.runOneShotAsyncGenerator` and prints the step stream in
//	the bracketed/tagged format the dispatcher logs expect (#220). Extracted from
//	CliChatHelper so a job/workflow worker (which loads this package as a library)
//	can drive a one-shot run with identical output, without pulling in the chat
//	REPL plumbing.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class AgentRunnerDriver {
	static async runOneShot(roleAgentContext: AgentRunnerContext, userInput: string, {
		verboseLevel = 0,
		streamingEnabled = false,
	}: {
		verboseLevel?: number,
		streamingEnabled?: boolean,
	}): Promise<void> {
		// init text spinner - to show a spinner while waiting for the api response
		const textSpinner = new TextSpinner()

		// display a spinner
		textSpinner.start()

		// Build the async generator for the agent response
		const agentAsyncGenerator = AgentRunner.runOneShotAsyncGenerator(roleAgentContext, userInput, {
			streamingEnabled: streamingEnabled,
		});

		// consume the async generator until it's done, writing chunks to stdout as they come in
		let iterResult = await agentAsyncGenerator.next();
		while (iterResult.done !== true) {
			const stepResult: AgentRunnerStepResult = iterResult.value;
			// if the chunkOutput is a string, write it to stdout
			if (textSpinner.isSpinning() === true) textSpinner.stop()
			// goto next iteration
			iterResult = await agentAsyncGenerator.next();
			// display chunkOutput to stdout
			if (streamingEnabled && stepResult.type === 'text') {
				process.stdout.write(stepResult.text);
			} else if (streamingEnabled && stepResult.type === 'handoff') {
				console.log()
				console.log(Chalk.gray(`--- Agent handoff: ${stepResult.agentName} → ${stepResult.toAgentName} ---`))
			}
		}

		// get the final output from the last value returned by the async generator
		const finalOutput = iterResult.value;

		// stop the spinner
		if (textSpinner.isSpinning() === true) {
			textSpinner.stop()
		}

		// display the response in colored markdown format (skip if streaming already printed it)
		if (streamingEnabled === false) {
			console.log(new MarkdownChalk().parse(finalOutput.text))
		} else {
			console.log() // add a newline after streaming output
		}
	}
}
