import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import { SkilledCrewYamlConfigHelper } from '../../../src/config/skilled_crew_yaml/skilled_crew_yaml_config_helper';

describe('SkilledCrewYamlConfigHelper', () => {
	let tmpDir: string;

	before(async () => {
		tmpDir = await Fs.promises.mkdtemp(Path.join(Os.tmpdir(), 'skilled-crew-yaml-test-'));
	});

	after(async () => {
		await Fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it('loads minimal valid YAML (agents only) with default values', async () => {
		const filePath = Path.join(tmpDir, 'minimal.yaml');
		await Fs.promises.writeFile(filePath, [
			'agents:',
			'  main: {}',
		].join('\n'));

		const config = await SkilledCrewYamlConfigHelper.loadConfig(filePath);
		assert.equal(config.version, '1.0');
		assert.equal(config.id, 'skillet-id-unspecified');
		assert.ok('main' in config.agents);
		assert.deepEqual(config.commands, []);
		assert.equal(config.agents['main'].instructionsPath, null);
		assert.deepEqual(config.agents['main'].skills, []);
	});

	it('loads YAML with agents, skills, and MCP servers, resolving relative paths to absolute', async () => {
		const filePath = Path.join(tmpDir, 'full.yaml');
		await Fs.promises.writeFile(filePath, [
			'version: "1.1"',
			'id: test-full',
			'agents:',
			'  main:',
			'    instructionsPath: ./AGENTS.md',
			'    skills:',
			'      - name: my-skill',
			'        folderPath: ./skills/my-skill',
			'    mcp_servers:',
			'      - filePath: ./mcp/server.json',
		].join('\n'));

		const config = await SkilledCrewYamlConfigHelper.loadConfig(filePath);
		assert.equal(config.version, '1.1');
		assert.equal(config.id, 'test-full');

		const mainAgent = config.agents['main'];
		assert.ok(mainAgent !== undefined);
		assert.ok(mainAgent.instructionsPath !== null);
		assert.ok(Path.isAbsolute(mainAgent.instructionsPath));
		assert.ok(mainAgent.instructionsPath.endsWith('AGENTS.md'));

		assert.equal(mainAgent.skills.length, 1);
		assert.ok(Path.isAbsolute(mainAgent.skills[0].folderPath));

		assert.equal(mainAgent.mcp_servers.length, 1);
		assert.ok(Path.isAbsolute(mainAgent.mcp_servers[0].filePath));
	});

	it('throws when the YAML file does not exist', async () => {
		const missingPath = Path.join(tmpDir, 'nonexistent.yaml');
		await assert.rejects(
			SkilledCrewYamlConfigHelper.loadConfig(missingPath),
		);
	});

	it('throws on malformed YAML (unclosed flow sequence)', async () => {
		const filePath = Path.join(tmpDir, 'malformed.yaml');
		await Fs.promises.writeFile(filePath, 'agents: [');

		await assert.rejects(
			SkilledCrewYamlConfigHelper.loadConfig(filePath),
		);
	});

	it('loads YAML with commands and resolves command file paths', async () => {
		const filePath = Path.join(tmpDir, 'with-commands.yaml');
		await Fs.promises.writeFile(filePath, [
			'commands:',
			'  - name: my-cmd',
			'    filePath: ./commands/my.command.md',
			'agents:',
			'  main: {}',
		].join('\n'));

		const config = await SkilledCrewYamlConfigHelper.loadConfig(filePath);
		assert.equal(config.commands.length, 1);
		assert.equal(config.commands[0].name, 'my-cmd');
		assert.ok(Path.isAbsolute(config.commands[0].filePath));
		assert.ok(config.commands[0].filePath.endsWith('my.command.md'));
	});
});
