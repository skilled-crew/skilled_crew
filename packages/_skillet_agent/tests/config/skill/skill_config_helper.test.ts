import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import { SkillConfigHelper } from '../../../src/config/skill/skill_config_helper';

describe('SkillConfigHelper.parseAllowedTools', () => {
	it('parses multiple tools with and without args', async () => {
		const result = await SkillConfigHelper.parseAllowedTools('Bash(python:*) Read Write');
		assert.equal(result.length, 3);
		assert.equal(result[0].name, 'Bash');
		assert.equal(result[0].args, 'python:*');
		assert.equal(result[1].name, 'Read');
		assert.equal(result[1].args, undefined);
		assert.equal(result[2].name, 'Write');
		assert.equal(result[2].args, undefined);
	});

	it('parses a single tool without args', async () => {
		const result = await SkillConfigHelper.parseAllowedTools('Read');
		assert.equal(result.length, 1);
		assert.equal(result[0].name, 'Read');
		assert.equal(result[0].args, undefined);
	});

	it('returns empty array for empty string', async () => {
		const result = await SkillConfigHelper.parseAllowedTools('');
		assert.deepEqual(result, []);
	});
});

describe('SkillConfigHelper.loadSkillDoc', () => {
	let tmpDir: string;

	before(async () => {
		tmpDir = await Fs.promises.mkdtemp(Path.join(Os.tmpdir(), 'skillet-skill-test-'));
	});

	after(async () => {
		await Fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it('loads a valid skill with all optional fields', async () => {
		const skillDir = Path.join(tmpDir, 'valid-skill');
		await Fs.promises.mkdir(skillDir, { recursive: true });
		await Fs.promises.writeFile(Path.join(skillDir, 'SKILL.md'), [
			'---',
			'name: my-skill',
			'description: A valid skill',
			'license: MIT',
			'compatibility:',
			'  - node18',
			'  - node20',
			'---',
			'',
			'Skill instructions here.',
		].join('\n'));

		const skillDoc = await SkillConfigHelper.loadSkillDoc(skillDir);
		assert.equal(skillDoc.header.name, 'my-skill');
		assert.equal(skillDoc.header.description, 'A valid skill');
		assert.equal(skillDoc.header.license, 'MIT');
		assert.deepEqual(skillDoc.header.compatibility, ['node18', 'node20']);
		assert.match(skillDoc.body, /Skill instructions here/);
	});

	it('loads a valid skill with allowed-tools and parses them', async () => {
		const skillDir = Path.join(tmpDir, 'skill-with-tools');
		await Fs.promises.mkdir(skillDir, { recursive: true });
		await Fs.promises.writeFile(Path.join(skillDir, 'SKILL.md'), [
			'---',
			'name: tool-skill',
			'description: A skill with tools',
			'allowed-tools: Bash(python:*) Read',
			'---',
		].join('\n'));

		const skillDoc = await SkillConfigHelper.loadSkillDoc(skillDir);
		assert.ok(skillDoc.header.allowedTools !== undefined);
		assert.equal(skillDoc.header.allowedTools.length, 2);
		assert.equal(skillDoc.header.allowedTools[0].name, 'Bash');
		assert.equal(skillDoc.header.allowedTools[0].args, 'python:*');
		assert.equal(skillDoc.header.allowedTools[1].name, 'Read');
		assert.equal(skillDoc.header.allowedTools[1].args, undefined);
	});

	it('loads a skill without allowed-tools (defaults to undefined)', async () => {
		const skillDir = Path.join(tmpDir, 'skill-no-tools');
		await Fs.promises.mkdir(skillDir, { recursive: true });
		await Fs.promises.writeFile(Path.join(skillDir, 'SKILL.md'), [
			'---',
			'name: basic-skill',
			'description: A skill without tools',
			'---',
		].join('\n'));

		const skillDoc = await SkillConfigHelper.loadSkillDoc(skillDir);
		assert.equal(skillDoc.header.allowedTools, undefined);
	});

	it('throws when Bash tool is missing command:pattern args', async () => {
		const skillDir = Path.join(tmpDir, 'skill-bad-bash');
		await Fs.promises.mkdir(skillDir, { recursive: true });
		await Fs.promises.writeFile(Path.join(skillDir, 'SKILL.md'), [
			'---',
			'name: bad-bash',
			'description: A skill with bad Bash tool spec',
			'allowed-tools: Bash',
			'---',
		].join('\n'));

		await assert.rejects(
			SkillConfigHelper.loadSkillDoc(skillDir),
			/Bash/,
		);
	});

	it('throws on extra unknown fields in frontmatter (strict schema)', async () => {
		const skillDir = Path.join(tmpDir, 'skill-unknown-fields');
		await Fs.promises.mkdir(skillDir, { recursive: true });
		await Fs.promises.writeFile(Path.join(skillDir, 'SKILL.md'), [
			'---',
			'name: my-skill',
			'description: A skill with extra fields',
			'unknown-field: should-fail',
			'---',
		].join('\n'));

		await assert.rejects(
			SkillConfigHelper.loadSkillDoc(skillDir),
		);
	});

	it('throws when skill name contains spaces (regex validation)', async () => {
		const skillDir = Path.join(tmpDir, 'skill-name-spaces');
		await Fs.promises.mkdir(skillDir, { recursive: true });
		await Fs.promises.writeFile(Path.join(skillDir, 'SKILL.md'), [
			'---',
			'name: invalid name with spaces',
			'description: A skill with invalid name',
			'---',
		].join('\n'));

		await assert.rejects(
			SkillConfigHelper.loadSkillDoc(skillDir),
		);
	});
});
