import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRunnerToolRunScriptInputSchema } from '../../src/agent_runner/agent_runner_schemas';

describe('AgentRunnerToolRunScriptInputSchema', () => {
	it('accepts valid input with reason and commandLine', () => {
		const result = AgentRunnerToolRunScriptInputSchema.parse({
			reason: 'Run the test suite',
			commandLine: 'npm test',
		});
		assert.equal(result.reason, 'Run the test suite');
		assert.equal(result.commandLine, 'npm test');
	});

	it('throws on missing commandLine field', () => {
		assert.throws(() => {
			AgentRunnerToolRunScriptInputSchema.parse({
				reason: 'test only',
			});
		});
	});

	it('throws on missing reason field', () => {
		assert.throws(() => {
			AgentRunnerToolRunScriptInputSchema.parse({
				commandLine: 'echo hello',
			});
		});
	});

	it('rejects output-shaped data (catches schema mismatch bug)', () => {
		assert.throws(() => {
			AgentRunnerToolRunScriptInputSchema.parse({
				exitCode: 0,
				stdout: 'hello',
				stderr: '',
				timedOut: false,
			});
		});
	});

	it('rejects empty object', () => {
		assert.throws(() => {
			AgentRunnerToolRunScriptInputSchema.parse({});
		});
	});
});
