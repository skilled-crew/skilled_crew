import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import { AgentConfigHelper } from '../../../src/config/agent/agent_config_helper';

describe('AgentConfigHelper', () => {
	let tmpDir: string;

	before(async () => {
		tmpDir = await Fs.promises.mkdtemp(Path.join(Os.tmpdir(), 'skillet-agent-test-'));
	});

	after(async () => {
		await Fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it('loads valid AGENTS.md with frontmatter and body', async () => {
		const filePath = Path.join(tmpDir, 'valid-agents.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'name: my-agent',
			'description: A valid agent',
			'---',
			'',
			'Agent instructions here.',
		].join('\n'));

		const config = await AgentConfigHelper.loadConfig({
			instructionsPath: filePath,
			codeWorkerPath: null,
			mcp_servers: [],
			skills: [],
		});

		assert.ok(config.agents !== null);
		assert.equal(config.agents.header.name, 'my-agent');
		assert.equal(config.agents.header.description, 'A valid agent');
		assert.equal(config.agents.header.model, null);
		assert.match(config.agents.body, /Agent instructions here/);
	});

	it('returns null agents when instructionsPath is null', async () => {
		const config = await AgentConfigHelper.loadConfig({
			instructionsPath: null,
			codeWorkerPath: null,
			mcp_servers: [],
			skills: [],
		});

		assert.equal(config.agents, null);
		assert.deepEqual(config.skillDocs, []);
	});

	it('throws on missing required name field', async () => {
		const filePath = Path.join(tmpDir, 'missing-name.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'description: An agent without a name',
			'---',
		].join('\n'));

		await assert.rejects(
			AgentConfigHelper.loadConfig({
				instructionsPath: filePath,
				codeWorkerPath: null,
				mcp_servers: [],
				skills: [],
			}),
		);
	});

	it('throws on extra unknown fields due to strict schema', async () => {
		const filePath = Path.join(tmpDir, 'extra-fields.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'name: my-agent',
			'description: A valid agent',
			'unknown-field: extra value',
			'---',
		].join('\n'));

		await assert.rejects(
			AgentConfigHelper.loadConfig({
				instructionsPath: filePath,
				codeWorkerPath: null,
				mcp_servers: [],
				skills: [],
			}),
		);
	});

	it('handles empty body', async () => {
		const filePath = Path.join(tmpDir, 'empty-body.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'name: my-agent',
			'description: A valid agent',
			'---',
		].join('\n'));

		const config = await AgentConfigHelper.loadConfig({
			instructionsPath: filePath,
			codeWorkerPath: null,
			mcp_servers: [],
			skills: [],
		});

		assert.ok(config.agents !== null);
		assert.equal(config.agents.body.trim(), '');
	});

	it('handles UTF-8 content without corruption', async () => {
		const filePath = Path.join(tmpDir, 'utf8-agents.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'name: my-agent',
			'description: Agente de prueba',
			'---',
			'',
			'Instrucciones en español. 日本語テスト.',
		].join('\n'), 'utf8');

		const config = await AgentConfigHelper.loadConfig({
			instructionsPath: filePath,
			codeWorkerPath: null,
			mcp_servers: [],
			skills: [],
		});

		assert.ok(config.agents !== null);
		assert.match(config.agents.body, /Instrucciones en español/);
	});

	it('throws on duplicate skill names', async () => {
		const agentFile = Path.join(tmpDir, 'dup-agent.md');
		await Fs.promises.writeFile(agentFile, [
			'---',
			'name: my-agent',
			'description: A valid agent',
			'---',
		].join('\n'));

		const skill1Dir = Path.join(tmpDir, 'skill1-dup');
		const skill2Dir = Path.join(tmpDir, 'skill2-dup');
		await Fs.promises.mkdir(skill1Dir, { recursive: true });
		await Fs.promises.mkdir(skill2Dir, { recursive: true });

		const skillContent = [
			'---',
			'name: same-name',
			'description: A skill with duplicate name',
			'---',
		].join('\n');
		await Fs.promises.writeFile(Path.join(skill1Dir, 'SKILL.md'), skillContent);
		await Fs.promises.writeFile(Path.join(skill2Dir, 'SKILL.md'), skillContent);

		await assert.rejects(
			AgentConfigHelper.loadConfig({
				instructionsPath: agentFile,
				codeWorkerPath: null,
				mcp_servers: [],
				skills: [
					{ name: 'same-name', folderPath: skill1Dir },
					{ name: 'same-name', folderPath: skill2Dir },
				],
			}),
			/Duplicate SKILL name/,
		);
	});
});
