// node imports
import Path from 'node:path';
import Assert from 'node:assert';

// npm imports
import Chalk from 'chalk';

// local imports
import { AgentRunnerInit } from '../agent_runner/agent_runner_init';
import { SkilledCrewYamlConfigHelper } from '../config/skilled_crew_yaml/skilled_crew_yaml_config_helper';
import { EvalConfigHelper } from '../evals/eval_config_helper';
import { EvalRunner } from '../evals/eval_runner';
import { EvalGrader } from '../evals/eval_grader';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class CliEvalHelper {

	static async run(options: { evalFolderPath: string; skilledCrewYamlConfigPath: string; verboseLevel: number }): Promise<void> {
		// resolve paths to absolute
		const evalFolderPath = Path.resolve(options.evalFolderPath);
		const skilledCrewYamlConfigPath = Path.resolve(options.skilledCrewYamlConfigPath);

		// load the YAML config (paths are resolved to absolute inside loadConfig)
		const skilledCrewYamlConfig = await SkilledCrewYamlConfigHelper.loadConfig(skilledCrewYamlConfigPath);

		// create agent context from the config as-is
		const agentRunnerContext = await AgentRunnerInit.createAgentRunnerContextFromConfig({
			skilledCrewYamlConfig,
			userId: 'eval_user',
			sessionName: `eval_session_${Date.now()}`,
			verboseLevel: options.verboseLevel,
		});

		// load evals config
		const evalsConfig = await EvalConfigHelper.loadEvalsConfig(evalFolderPath);

		console.log(`[${Chalk.cyan('eval')}] Loaded ${evalsConfig.evals.length} evals for ${Chalk.green(evalsConfig.name)}`);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// run all evals
		const evalRunResults = await EvalRunner.runAllEvals(agentRunnerContext, evalsConfig);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// Write all eval run results to files and print summary
		for (const evalRunResult of evalRunResults) {
			const evalDefinition = evalsConfig.evals.find(evalDefinition => evalDefinition.id === evalRunResult.evalId);
			Assert.ok(evalDefinition, `Eval definition not found for evalId ${evalRunResult.evalId}`);

			// log to tty
			console.log([
				`[${Chalk.cyan('eval')}]`,
				`Eval ${evalRunResult.evalId}`,
				`completed in ${evalRunResult.responseDelayMs}ms`,
				`with ${evalRunResult.responseCharCount} chars`,
				`→ ${Chalk.gray(evalDefinition.prompt.substring(0, 80))}`,
			].join(' '));

			// write eval run result to file
			const outputPath = await EvalConfigHelper.writeEvalRunResult(evalFolderPath, evalRunResult);
			console.log(`[${Chalk.cyan('eval')}] - saved in ${Chalk.gray(outputPath)}`);
		}

		// print summary
		console.log();
		console.log(`[${Chalk.cyan('eval')}] Completed ${evalRunResults.length} evals:`);
		for (const evalRunResult of evalRunResults) {
			console.log(`  eval_id=${evalRunResult.evalId} delay=${evalRunResult.responseDelayMs}ms chars=${evalRunResult.responseCharCount}`);
		}

		// cleanup MCP servers
		for (const mcpServer of agentRunnerContext.mcpServers) {
			await mcpServer.close();
		}
	}

	static async grade(options: { evalFolderPath: string }): Promise<void> {
		const evalFolderPath = Path.resolve(options.evalFolderPath);

		// load evals config
		const evalsConfig = await EvalConfigHelper.loadEvalsConfig(evalFolderPath);
		console.log(`[${Chalk.cyan('grade')}] Loaded ${evalsConfig.evals.length} evals for ${Chalk.green(evalsConfig.name)}`);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// grade all evals
		const evalGradeResults = await EvalGrader.gradeAllEvals(evalsConfig, evalFolderPath);

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// Write all eval grade results to files and print summary
		for (const evalGradeResult of evalGradeResults) {
			const evalDefinition = evalsConfig.evals.find(evalDefinition => evalDefinition.id === evalGradeResult.evalId);
			Assert.ok(evalDefinition, `Eval definition not found for evalId ${evalGradeResult.evalId}`);

			// log to tty
			console.log([
				`[${Chalk.cyan('grade')}]`,
				`Graded eval ${evalGradeResult.evalId}`,
				`(${Chalk.gray(evalDefinition?.prompt.substring(0, 80) ?? '')})`,
				`→ expected_output=${evalGradeResult.expectedOutput.score}/10`,
			].join(' '));

			// write grade result to file
			const outputPath = await EvalConfigHelper.writeEvalGradeResult(evalFolderPath, evalGradeResult);
			console.log(`[${Chalk.cyan('grade')}] - saved in ${Chalk.gray(outputPath)}`);
		}

		// print summary
		console.log();
		console.log(`[${Chalk.cyan('grade')}] Completed grading ${evalGradeResults.length} evals:`);
		for (const gradeResult of evalGradeResults) {
			const assertionScores = gradeResult.assertions.map(a => a.score).join(', ');
			console.log(`  eval_id=${gradeResult.evalId} expected_output=${gradeResult.expectedOutput.score}/10 assertions=[${assertionScores}]`);
		}
	}
}
