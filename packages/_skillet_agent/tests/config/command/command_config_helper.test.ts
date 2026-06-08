import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import { CommandConfigHelper } from '../../../src/config/command/command_config_helper';

describe('CommandConfigHelper', () => {
	let tmpDir: string;

	before(async () => {
		tmpDir = await Fs.promises.mkdtemp(Path.join(Os.tmpdir(), 'skillet-cmd-test-'));
	});

	after(async () => {
		await Fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it('loads a valid command file', async () => {
		const filePath = Path.join(tmpDir, 'my.command.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'description: Greets the user',
			'---',
			'',
			'Hello, world!',
		].join('\n'));

		const docs = await CommandConfigHelper.loadConfig([
			{ name: 'greet', filePath },
		]);

		assert.equal(docs.length, 1);
		assert.equal(docs[0].commandName, 'greet');
		assert.equal(docs[0].header.description, 'Greets the user');
		assert.equal(docs[0].content, 'Hello, world!');
	});

	it('loads a command file with optional agent field', async () => {
		const filePath = Path.join(tmpDir, 'agent.command.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'description: Runs on a specific agent',
			'agent: my-agent',
			'---',
			'',
			'Agent-specific instructions.',
		].join('\n'));

		const docs = await CommandConfigHelper.loadConfig([
			{ name: 'agent-cmd', filePath },
		]);

		assert.equal(docs.length, 1);
		assert.equal(docs[0].header.agent, 'my-agent');
	});

	it('returns empty array for no command files', async () => {
		const docs = await CommandConfigHelper.loadConfig([]);
		assert.deepEqual(docs, []);
	});

	it('skips file not found with warning (returns empty array)', async () => {
		const docs = await CommandConfigHelper.loadConfig([
			{ name: 'missing', filePath: Path.join(tmpDir, 'nonexistent.command.md') },
		]);
		assert.deepEqual(docs, []);
	});

	it('skips file with missing required description field (returns empty array)', async () => {
		const filePath = Path.join(tmpDir, 'invalid.command.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'agent: some-agent',
			'---',
		].join('\n'));

		const docs = await CommandConfigHelper.loadConfig([
			{ name: 'invalid', filePath },
		]);
		assert.deepEqual(docs, []);
	});

	it('returns body content unchanged when no template variables', async () => {
		const filePath = Path.join(tmpDir, 'notemplate.command.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'description: A command with no templates',
			'---',
			'',
			'Plain text content.',
		].join('\n'));

		const docs = await CommandConfigHelper.loadConfig([
			{ name: 'plain', filePath },
		]);

		assert.equal(docs[0].content, 'Plain text content.');
	});

	it('trims leading and trailing whitespace from content', async () => {
		const filePath = Path.join(tmpDir, 'whitespace.command.md');
		await Fs.promises.writeFile(filePath, [
			'---',
			'description: A command with surrounding whitespace',
			'---',
			'',
			'  Content with spaces.  ',
		].join('\n'));

		const docs = await CommandConfigHelper.loadConfig([
			{ name: 'ws', filePath },
		]);

		assert.equal(docs[0].content, 'Content with spaces.');
	});
});
