// node imports
import Assert from 'node:assert';

// npm imports
import Chalk from 'chalk';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z as Zod } from 'zod';

// local imports
import { UtilsAi } from '../libs/utils_ai';
import { EvalDefinition, EvalsConfig, EvalRunResult, EvalGradeItem, EvalGradeResult } from './eval_types';
import { EvalConfigHelper } from './eval_config_helper';
import { EvalGradeItemZod } from './eval_schemas';

export class EvalGrader {

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	static async gradeAllEvals(evalsConfig: EvalsConfig, evalFolderPath: string): Promise<EvalGradeResult[]> {
		const evalGradeResults: EvalGradeResult[] = [];

		for (const evalDefinition of evalsConfig.evals) {
			console.log(`[${Chalk.cyan('grade')}] Grading eval ${evalDefinition.id}: ${Chalk.gray(evalDefinition.prompt.substring(0, 80))}`);

			const evalRunResult = await EvalConfigHelper.readEvalRunResult(evalFolderPath, evalDefinition.id);
			const evalGradeResult = await EvalGrader._gradeSingleEval(evalDefinition, evalRunResult);

			evalGradeResults.push(evalGradeResult);
		}

		return evalGradeResults;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static async _gradeSingleEval(evalDefinition: EvalDefinition, evalRunResult: EvalRunResult): Promise<EvalGradeResult> {
		const responseLogStr = JSON.stringify(evalRunResult.responseLog, null, '\t');
		const modelSpec = process.env.SKILLET_MODEL_EVAL ?? 'openai/gpt-4.1-nano';

		// Grading evalDefinition.expected_output against the response log
		const expectedOutputGrade = await EvalGrader._judgeWithLlm(responseLogStr, evalDefinition.expected_output, {
			modelSpec,
		});

		// Grading evalDefinition.assertions against the response log
		// const assertionGrades: EvalGradeItem[] = [];
		// for (const assertion of evalDefinition.assertions) {
		// 	const assertionGrade = await EvalGrader._judgeWithLlm(responseLogStr, assertion, {
		// 		modelSpec,
		// 	});
		// 	assertionGrades.push(assertionGrade);
		// }
		const assertionGrades: EvalGradeItem[] = await EvalGrader._judgeWithLlmMany(responseLogStr, evalDefinition.assertions, {
			modelSpec,
		});

		const evalGradeResult: EvalGradeResult = {
			evalId: evalDefinition.id,
			expectedOutput: expectedOutputGrade,
			assertions: assertionGrades,
		};

		return evalGradeResult;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static async _judgeWithLlmMany(responseLogStr: string, criterions: string[], options?: {
		modelSpec?: string;
	}): Promise<EvalGradeItem[]> {
		const modelSpec = options?.modelSpec ?? 'openai/gpt-4.1-mini';
		const { provider, modelName } = UtilsAi.parseProviderModel(modelSpec);
		const numberedCriterions = criterions.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n');
		const openaiClient = await UtilsAi.getOpenAiClient({
			provider,
		});

		// system prompt for the LLM judge
		const systemPrompt = [
			'You are an eval judge. You will be given a response log from an AI agent and multiple criterions to evaluate.',
			'Your job is to judge whether the response log satisfies each criterion.',
			'Return one grade per criterion, in the same order as the criterions are listed.',
		].join('\n');

		// user prompt for the LLM judge
		const userPrompt = [
			'## Response Log',
			responseLogStr,
			'',
			'## Criterions',
			numberedCriterions,
		].join('\n');

		const zodResponseZod = Zod.object({
			grades: Zod.array(EvalGradeItemZod),
		});

		const response = await openaiClient.chat.completions.create({
			model: modelName,
			messages: [
				{
					role: 'system',
					content: systemPrompt,
				},
				{
					role: 'user',
					content: userPrompt,
				},
			],
			response_format: zodResponseFormat(zodResponseZod, 'eval_grade_items'),
		});

		const content = response.choices[0].message?.content;
		Assert.ok(content, 'LLM judge returned no content');

		const zodResponseParsed = zodResponseZod.parse(JSON.parse(content));
		if (criterions.length !== zodResponseParsed.grades.length) {
			throw new Error(`LLM judge returned ${zodResponseParsed.grades.length} grades but expected ${criterions.length}. Response content: ${content}`);
		}

		const evalGradeItems: EvalGradeItem[] = zodResponseParsed.grades;
		return evalGradeItems;
	}

	private static async _judgeWithLlm(responseLogStr: string, criterion: string, {
		modelSpec = 'openai/gpt-4.1-mini',
	}: {
		modelSpec?: string;
	} = {}): Promise<EvalGradeItem> {
		const { provider, modelName } = UtilsAi.parseProviderModel(modelSpec);
		const openaiClient = await UtilsAi.getOpenAiClient({
			provider,
		});

		const systemPrompt = [
			'You are an eval judge. You will be given a response log from an AI agent and a criterion to evaluate.',
			'Your job is to judge whether the response log satisfies the criterion.',
		].join('\n');

		const userPrompt = [
			'## Response Log',
			responseLogStr,
			'',
			'## Criterion',
			criterion,
		].join('\n');

		const response = await openaiClient.chat.completions.create({
			model: modelName,
			messages: [
				{
					role: 'system',
					content: systemPrompt
				},
				{
					role: 'user',
					content: userPrompt
				},
			],
			response_format: zodResponseFormat(EvalGradeItemZod, "event"),
		});

		const content = response.choices[0].message?.content
		// sanity check
		Assert.ok(content, 'LLM judge returned no content');
		// parse and validate the LLM judge response with zod
		const evalGradeItem: EvalGradeItem = EvalGradeItemZod.parse(JSON.parse(content))

		return evalGradeItem;
	}
}
