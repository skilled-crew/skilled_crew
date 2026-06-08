import Assert from 'node:assert';

import { UtilsAi } from './utils_ai';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	AiOneShot — one stateless language-model call that returns plain text.
//
//	The lowest-level way to ask a model a single question from ordinary code, with
//	no agent/session machinery. Used by deterministic code-workers that need a
//	single generation on one branch (e.g. the editor worker rewriting a post),
//	while staying purely mechanical on every other branch. Cost tracking is
//	automatic via `bucketId` (see UtilsAi.getOpenAiClient).
//
//	Returns text rather than structured output on purpose: callers are in other
//	packages with their own Zod instance, and a single string keeps them decoupled.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class AiOneShot {
	/**
	 * Run one system+user prompt against `modelSpec` (e.g. 'openai/gpt-4.1-mini')
	 * and return the trimmed text reply. `bucketId` attributes the spend in the
	 * cost tracker. Throws if the model returns no content.
	 */
	static async complete({
		modelSpec,
		system,
		user,
		bucketId,
	}: {
		modelSpec: string;
		system: string;
		user: string;
		bucketId: string;
	}): Promise<string> {
		const { provider, modelName } = UtilsAi.parseProviderModel(modelSpec);
		const openaiClient = await UtilsAi.getOpenAiClient({ provider, bucketId });

		const response = await openaiClient.chat.completions.create({
			model: modelName,
			messages: [
				{ role: 'system', content: system },
				{ role: 'user', content: user },
			],
		});

		const content = response.choices[0]?.message?.content;
		Assert.ok(content !== undefined && content !== null && content.length > 0, 'AiOneShot: model returned no content');
		return content.trim();
	}
}
