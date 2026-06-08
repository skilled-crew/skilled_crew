import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { UtilsAi } from '../../src/libs/utils_ai';

describe('UtilsAi.checkModelRunnerRunnable (#265)', () => {
	// Snapshot and restore every env var the check reads so tests never leak
	// state into each other or into the developer's real environment.
	const ENV_KEYS = ['SKILLET_MODEL_RUNNER', 'OPENAI_API_KEY', 'LMSTUDIO_BASE_URL', 'OLLAMA_BASE_URL'] as const;
	let savedEnv: Record<string, string | undefined>;

	beforeEach(() => {
		savedEnv = {};
		for (const key of ENV_KEYS) {
			savedEnv[key] = process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = savedEnv[key];
			}
		}
	});

	it('returns null when SKILLET_MODEL_RUNNER is unset', async () => {
		delete process.env.SKILLET_MODEL_RUNNER;
		assert.equal(await UtilsAi.checkModelRunnerRunnable(), null);
	});

	it('returns null when SKILLET_MODEL_RUNNER is the empty string', async () => {
		process.env.SKILLET_MODEL_RUNNER = '';
		assert.equal(await UtilsAi.checkModelRunnerRunnable(), null);
	});

	it('surfaces the parse error for a spec without a provider prefix', async () => {
		process.env.SKILLET_MODEL_RUNNER = 'gpt-4.1-nano';
		const message = await UtilsAi.checkModelRunnerRunnable();
		assert.match(message ?? '', /Invalid model spec/);
	});

	it('surfaces the parse error for an unknown provider', async () => {
		process.env.SKILLET_MODEL_RUNNER = 'anthropic/claude';
		const message = await UtilsAi.checkModelRunnerRunnable();
		assert.match(message ?? '', /Unknown provider/);
	});

	describe('openai', () => {
		it('returns null when OPENAI_API_KEY is set', async () => {
			process.env.SKILLET_MODEL_RUNNER = 'openai/gpt-4.1-nano';
			process.env.OPENAI_API_KEY = 'sk-test';
			assert.equal(await UtilsAi.checkModelRunnerRunnable(), null);
		});

		it('returns a message naming OPENAI_API_KEY when it is missing', async () => {
			process.env.SKILLET_MODEL_RUNNER = 'openai/gpt-4.1-nano';
			delete process.env.OPENAI_API_KEY;
			const message = await UtilsAi.checkModelRunnerRunnable();
			assert.match(message ?? '', /OPENAI_API_KEY is not set/);
		});

		it('treats an empty OPENAI_API_KEY as missing', async () => {
			process.env.SKILLET_MODEL_RUNNER = 'openai/gpt-4.1-nano';
			process.env.OPENAI_API_KEY = '';
			const message = await UtilsAi.checkModelRunnerRunnable();
			assert.match(message ?? '', /OPENAI_API_KEY is not set/);
		});
	});

	describe('local providers', () => {
		// 127.0.0.1:1 has no listener, so the probe gets an immediate connection
		// refusal — a fast, deterministic stand-in for "the server is not running".
		const UNREACHABLE_BASE_URL = 'http://127.0.0.1:1/v1';

		it('reports lmstudio unreachable and names LMSTUDIO_BASE_URL when the server is down', async () => {
			process.env.SKILLET_MODEL_RUNNER = 'lmstudio/some-model';
			process.env.LMSTUDIO_BASE_URL = UNREACHABLE_BASE_URL;
			const message = await UtilsAi.checkModelRunnerRunnable();
			assert.match(message ?? '', /lmstudio/);
			assert.match(message ?? '', /not reachable/);
			assert.match(message ?? '', /LMSTUDIO_BASE_URL/);
		});

		it('reports ollama unreachable and names OLLAMA_BASE_URL when the server is down', async () => {
			process.env.SKILLET_MODEL_RUNNER = 'ollama/some-model';
			process.env.OLLAMA_BASE_URL = UNREACHABLE_BASE_URL;
			const message = await UtilsAi.checkModelRunnerRunnable();
			assert.match(message ?? '', /ollama/);
			assert.match(message ?? '', /not reachable/);
			assert.match(message ?? '', /OLLAMA_BASE_URL/);
		});
	});
});
