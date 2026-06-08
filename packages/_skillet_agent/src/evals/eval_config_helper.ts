// node imports
import Fs from 'node:fs';
import Path from 'node:path';

// local imports
import { EvalsConfigZod } from './eval_schemas';
import { EvalsConfig, EvalRunResult, EvalGradeResult } from './eval_types';

export class EvalConfigHelper {
	static EVALS_OUTPUT_SUFFIX = '_output';

	static async loadEvalsConfig(evalFolderPath: string): Promise<EvalsConfig> {
		// read the evals.json file in the skill folder
		const evalsJsonPath = Path.join(evalFolderPath, 'evals.json');
		const fileContent = await Fs.promises.readFile(evalsJsonPath, 'utf8');
		// parse and validate the evals config with zod
		const evalsConfig = EvalsConfigZod.parse(JSON.parse(fileContent));
		// return the evals config
		return evalsConfig;
	}

	static async writeEvalRunResult(evalFolderPath: string, evalRunResult: EvalRunResult): Promise<string> {
		const evalRunsDir = `${evalFolderPath}${EvalConfigHelper.EVALS_OUTPUT_SUFFIX}`;

		// create evals_output directory if it doesn't exist
		const folderExists = await Fs.promises.stat(evalRunsDir).then(stat => stat.isDirectory()).catch(() => false);
		if (folderExists === false) {
			await Fs.promises.mkdir(evalRunsDir);
		}

		// write the eval run result to a file named eval_{eval_id}_run.json
		const outputPath = Path.join(evalRunsDir, `eval_${evalRunResult.evalId}_run.json`);
		await Fs.promises.writeFile(outputPath, JSON.stringify(evalRunResult, null, '\t'), 'utf8');

		// return the output path
		return outputPath;
	}

	static async readEvalRunResult(evalFolderPath: string, evalId: number): Promise<EvalRunResult> {
		const evalRunsDir = `${evalFolderPath}${EvalConfigHelper.EVALS_OUTPUT_SUFFIX}`;
		const evalRunPath = Path.join(evalRunsDir, `eval_${evalId}_run.json`);
		const fileContent = await Fs.promises.readFile(evalRunPath, 'utf8');
		const evalRunResult: EvalRunResult = JSON.parse(fileContent);
		return evalRunResult;
	}

	static async writeEvalGradeResult(evalFolderPath: string, evalGradeResult: EvalGradeResult): Promise<string> {
		const evalRunsDir = `${evalFolderPath}${EvalConfigHelper.EVALS_OUTPUT_SUFFIX}`;

		const folderExists = await Fs.promises.stat(evalRunsDir).then(stat => stat.isDirectory()).catch(() => false);
		if (folderExists === false) {
			await Fs.promises.mkdir(evalRunsDir);
		}

		const outputPath = Path.join(evalRunsDir, `eval_${evalGradeResult.evalId}_grade.json`);
		await Fs.promises.writeFile(outputPath, JSON.stringify(evalGradeResult, null, '\t'), 'utf8');

		return outputPath;
	}
}
