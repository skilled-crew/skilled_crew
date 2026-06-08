import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AgentRunnerInit } from '../../src/agent_runner/agent_runner_init';
import { AgentRunnerConstants } from '../../src/agent_runner/agent_runner_types';

describe('AgentRunnerInit._resolveMaxTurns (#193)', () => {
	it('defaults to 50 when SKILLET_MAX_TURNS is unset or empty', () => {
		assert.equal(AgentRunnerInit._resolveMaxTurns(undefined), AgentRunnerConstants.DEFAULT_MAX_TURNS);
		assert.equal(AgentRunnerInit._resolveMaxTurns(''), 50);
	});

	it('honors a positive integer override', () => {
		assert.equal(AgentRunnerInit._resolveMaxTurns('15'), 15);
		assert.equal(AgentRunnerInit._resolveMaxTurns('1'), 1);
	});

	it('throws on non-positive or non-integer values', () => {
		assert.throws(() => AgentRunnerInit._resolveMaxTurns('0'));
		assert.throws(() => AgentRunnerInit._resolveMaxTurns('-5'));
		assert.throws(() => AgentRunnerInit._resolveMaxTurns('3.5'));
		assert.throws(() => AgentRunnerInit._resolveMaxTurns('abc'));
	});
});
