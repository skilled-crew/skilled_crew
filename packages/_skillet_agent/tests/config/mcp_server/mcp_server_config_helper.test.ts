import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import { McpServerConfigHelper } from '../../../src/config/mcp_server/mcp_server_config_helper';

describe('McpServerConfigHelper', () => {
	let tmpDir: string;

	before(async () => {
		tmpDir = await Fs.promises.mkdtemp(Path.join(Os.tmpdir(), 'skillet-mcp-test-'));
	});

	after(async () => {
		await Fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it('loads stdio transport config with all fields', async () => {
		const filePath = Path.join(tmpDir, 'stdio.json');
		await Fs.promises.writeFile(filePath, JSON.stringify({
			name: 'my-stdio-server',
			type: 'stdio',
			command: 'node',
			args: ['server.js'],
			env: { NODE_ENV: 'production' },
			cwd: '/tmp',
		}));

		const configs = await McpServerConfigHelper.loadConfig([{ filePath }]);
		assert.equal(configs.length, 1);
		const config = configs[0];
		assert.equal(config.type, 'stdio');
		if (config.type === 'stdio') {
			assert.equal(config.name, 'my-stdio-server');
			assert.equal(config.command, 'node');
			assert.deepEqual(config.args, ['server.js']);
			assert.deepEqual(config.env, { NODE_ENV: 'production' });
		}
	});

	it('loads http transport config', async () => {
		const filePath = Path.join(tmpDir, 'http.json');
		await Fs.promises.writeFile(filePath, JSON.stringify({
			name: 'my-http-server',
			type: 'http',
			url: 'http://localhost:3000',
		}));

		const configs = await McpServerConfigHelper.loadConfig([{ filePath }]);
		assert.equal(configs.length, 1);
		const config = configs[0];
		assert.equal(config.type, 'http');
		if (config.type === 'http') {
			assert.equal(config.name, 'my-http-server');
			assert.equal(config.url, 'http://localhost:3000');
		}
	});

	it('loads sse transport config', async () => {
		const filePath = Path.join(tmpDir, 'sse.json');
		await Fs.promises.writeFile(filePath, JSON.stringify({
			name: 'my-sse-server',
			type: 'sse',
			url: 'http://localhost:4000/events',
		}));

		const configs = await McpServerConfigHelper.loadConfig([{ filePath }]);
		assert.equal(configs.length, 1);
		assert.equal(configs[0].type, 'sse');
		if (configs[0].type === 'sse') {
			assert.equal(configs[0].url, 'http://localhost:4000/events');
		}
	});

	it('throws on unknown transport type', async () => {
		const filePath = Path.join(tmpDir, 'unknown.json');
		await Fs.promises.writeFile(filePath, JSON.stringify({
			name: 'bad-server',
			type: 'websocket',
			url: 'ws://localhost:5000',
		}));

		await assert.rejects(
			McpServerConfigHelper.loadConfig([{ filePath }]),
		);
	});

	it('returns empty array for no configs', async () => {
		const configs = await McpServerConfigHelper.loadConfig([]);
		assert.deepEqual(configs, []);
	});
});
