// npm imports
import Chalk from 'chalk';

// local imports
import { AgentRunner } from '../agent_runner/agent_runner';
import { AgentRunnerContext, AgentRunnerStepResult, AgentRunnerFinalResult, AgentRunnerConstants } from '../agent_runner/agent_runner_types';
import { EvalDefinition, EvalsConfig, EvalRunResult } from './eval_types';

export class EvalRunner {

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	static async runAllEvals(agentRunnerContext: AgentRunnerContext, evalsConfig: EvalsConfig): Promise<EvalRunResult[]> {
		const evalRunResults: EvalRunResult[] = [];

		for (const evalDefinition of evalsConfig.evals) {
			console.log(`[${Chalk.cyan('eval')}] Running eval ${evalDefinition.id}: ${Chalk.gray(evalDefinition.prompt.substring(0, 80))}`);

			const evalRunResult = await EvalRunner._runSingleEval(agentRunnerContext, evalDefinition);
			evalRunResults.push(evalRunResult);
		}

		return evalRunResults;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static async _runSingleEval(agentRunnerContext: AgentRunnerContext, evalDefinition: EvalDefinition): Promise<EvalRunResult> {
		const stepResults: AgentRunnerStepResult[] = [];
		const startTime = performance.now();

		const asyncGenerator = AgentRunner.runOneShotAsyncGenerator(agentRunnerContext, evalDefinition.prompt, {
			// FIXME currently it doesnt return the step results if it is not in streaming mode
			streamingEnabled: true,
		});

		let iterResult = await asyncGenerator.next();
		while (iterResult.done !== true) {
			const stepResult = iterResult.value;
			// log all step results except TEXT, since those can be very long and we don't want to log them in the console
			if (stepResult.type !== AgentRunnerConstants.EVENT.TEXT) {
				stepResults.push(stepResult);
			}
			iterResult = await asyncGenerator.next();
		}

		const finalResult: AgentRunnerFinalResult = iterResult.value;
		const endTime = performance.now();

		const evalRunResult: EvalRunResult = {
			evalId: evalDefinition.id,
			responseLog: {
				stepResults: stepResults,
				finalResult,
			},
			responseDelayMs: Math.round(endTime - startTime),
			responseCharCount: finalResult.text.length,
		};

		return evalRunResult;
	}
}
