import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Os from 'node:os';
import { ScriptRunnerLocal } from '../../src/script_runner/script_runner_local';
import { ScriptRunnerSecurity } from '../../src/script_runner/script_runner_security';

const skillFolderPath = Os.tmpdir();
// A skill folder in the canonical `<crewRoot>/skills/<name>` layout, so the crew
// root (the sandbox boundary) is `/srv/mycrew`.
const CREW_SKILL_FOLDER = '/srv/mycrew/skills/gather-sources';

describe('ScriptRunnerLocal security checks', () => {
	it('rejects command with && chaining', async () => {
		await assert.rejects(
			ScriptRunnerLocal.runCommand('echo hello && echo world', skillFolderPath, []),
			/Command chaining is not allowed/,
		);
	});

	it('rejects command with ; chaining', async () => {
		await assert.rejects(
			ScriptRunnerLocal.runCommand('echo hello; echo world', skillFolderPath, []),
			/Command chaining is not allowed/,
		);
	});

	it('rejects command with | pipe', async () => {
		await assert.rejects(
			ScriptRunnerLocal.runCommand('echo hello | cat', skillFolderPath, []),
			/Command chaining is not allowed/,
		);
	});

	it('allows a shared crew script reached from a skill folder via `../../_src`', () => {
		// The regression behind crew_news_brief's gather-sources failure: a skill
		// command reaches the crew's shared _src/ — inside the crew root, so allowed.
		assert.doesNotThrow(() =>
			ScriptRunnerSecurity.checkCommandSecurity(
				'npx tsx ../../_src/gather_sources.ts from-config',
				CREW_SKILL_FOLDER,
			),
		);
	});

	it('allows an absolute path inside the crew root', () => {
		assert.doesNotThrow(() =>
			ScriptRunnerSecurity.checkCommandSecurity('cat /srv/mycrew/_src/data.json', CREW_SKILL_FOLDER),
		);
	});

	it('does not treat a non-path `..` argument as an escape', () => {
		assert.doesNotThrow(() =>
			ScriptRunnerSecurity.checkCommandSecurity('node script.js --range 1..10', CREW_SKILL_FOLDER),
		);
	});

	it('rejects a path that escapes the crew root', async () => {
		await assert.rejects(
			ScriptRunnerLocal.runCommand('cat ../../../../etc/passwd', CREW_SKILL_FOLDER, []),
			/escapes the crew sandbox/,
		);
	});

	it('rejects an absolute path outside the crew root', async () => {
		await assert.rejects(
			ScriptRunnerLocal.runCommand('cat /etc/passwd', CREW_SKILL_FOLDER, []),
			/escapes the crew sandbox/,
		);
	});

	it('allows command that passes all security checks with empty allowedTools', async () => {
		const output = await ScriptRunnerLocal.runCommand('echo hello', skillFolderPath, []);
		assert.equal(output.exitCode, 0);
		assert.match(output.stdout, /hello/);
	});

	it('rejects a command not in the allowed-tools allowlist', async () => {
		await assert.rejects(
			ScriptRunnerLocal.runCommand('echo hello', skillFolderPath, [{ name: 'Bash', args: 'git:*' }]),
			/is not allowed/,
		);
	});

	it('allows a command that matches the allowed-tools allowlist', async () => {
		const output = await ScriptRunnerLocal.runCommand('echo hello', skillFolderPath, [{ name: 'Bash', args: 'echo:*' }]);
		assert.equal(output.exitCode, 0);
		assert.match(output.stdout, /hello/);
	});
});

describe('ScriptRunnerSecurity heredoc handling', () => {
	// The writer stage's mandated form: pass a JSON draft to blackboard.ts via a
	// single-quoted heredoc on stdin. This is what crew_news_brief's "Publish the
	// daily brief markdown" job needs, and what the blanket newline ban broke.
	const draftHeredoc = [
		"npx tsx ../../_src/blackboard.ts write drafts - <<'JSON_END'",
		'{ "title": "developers\' workflows", "date": "2026-06-05", "markdown": "# Brief" }',
		'JSON_END',
	].join('\n');

	it('allows a single-quoted heredoc feeding JSON to a shared crew script', () => {
		assert.doesNotThrow(() =>
			ScriptRunnerSecurity.checkCommandSecurity(draftHeredoc, CREW_SKILL_FOLDER),
		);
	});

	it('exempts the heredoc body from the chaining checks', () => {
		// A real brief body can contain any of the banned metacharacters; the body
		// is stdin data, never shell, so none of these may be rejected.
		const body = '{ "md": "A && B || C | D ; E $(x) `y` \'apostrophe\' \\"quote\\"" }';
		const command = ["echo - <<'JSON_END'", body, 'JSON_END'].join('\n');
		assert.doesNotThrow(() =>
			ScriptRunnerSecurity.checkCommandSecurity(command, CREW_SKILL_FOLDER),
		);
	});

	it('still rejects a bare newline that does not open a heredoc (chaining)', () => {
		assert.throws(
			() => ScriptRunnerSecurity.checkCommandSecurity('echo a\necho b', CREW_SKILL_FOLDER),
			/Command chaining is not allowed \(found newline\)/,
		);
	});

	it('rejects command text after the closing delimiter (injection)', () => {
		const command = ["echo - <<'JSON_END'", '{ "x": 1 }', 'JSON_END', 'rm -rf /'].join('\n');
		assert.throws(
			() => ScriptRunnerSecurity.checkCommandSecurity(command, CREW_SKILL_FOLDER),
			/Commands after a heredoc body are not allowed/,
		);
	});

	it('rejects an unquoted heredoc delimiter (body would be shell-expanded)', () => {
		const command = ['echo - <<JSON_END', '$(whoami)', 'JSON_END'].join('\n');
		assert.throws(
			() => ScriptRunnerSecurity.checkCommandSecurity(command, CREW_SKILL_FOLDER),
			/Heredoc delimiter must be quoted/,
		);
	});

	it('rejects an unterminated heredoc', () => {
		const command = ["echo - <<'JSON_END'", '{ "x": 1 }'].join('\n');
		assert.throws(
			() => ScriptRunnerSecurity.checkCommandSecurity(command, CREW_SKILL_FOLDER),
			/Unterminated heredoc/,
		);
	});

	it('still validates the command line that opens the heredoc (path escape)', () => {
		const command = ["cat ../../../../etc/passwd <<'JSON_END'", 'x', 'JSON_END'].join('\n');
		assert.throws(
			() => ScriptRunnerSecurity.checkCommandSecurity(command, CREW_SKILL_FOLDER),
			/escapes the crew sandbox/,
		);
	});

	it('still rejects chaining on the heredoc opener line', () => {
		const command = ["echo a && echo b <<'JSON_END'", 'x', 'JSON_END'].join('\n');
		assert.throws(
			() => ScriptRunnerSecurity.checkCommandSecurity(command, CREW_SKILL_FOLDER),
			/Command chaining is not allowed \(found &&\)/,
		);
	});
});

describe('ScriptRunnerLocal heredoc execution', () => {
	it('passes a heredoc body to the child process stdin and returns exit 0', async () => {
		// End-to-end through the real security gate (no bypass): the heredoc must
		// both pass checkCommandSecurity AND actually feed stdin to the child. `cat`
		// echoes its stdin, mirroring how blackboard.ts reads the JSON draft.
		const command = [
			"cat <<'JSON_END'",
			'{ "ok": true, "note": "developers\' workflows are fine" }',
			'JSON_END',
		].join('\n');
		const output = await ScriptRunnerLocal.runCommand(command, skillFolderPath, []);
		assert.equal(output.exitCode, 0);
		assert.match(output.stdout, /"ok": true/);
		assert.match(output.stdout, /developers' workflows are fine/);
	});
});

describe('ScriptRunnerLocal subprocess execution', () => {
	it('runs echo and captures stdout', async () => {
		const output = await ScriptRunnerLocal.runCommand('echo hello', skillFolderPath, [], {
			bypassSecurity: true,
		});
		assert.equal(output.exitCode, 0);
		assert.match(output.stdout, /hello/);
		assert.equal(output.timedOut, false);
	});

	it('captures non-zero exit code', async () => {
		const output = await ScriptRunnerLocal.runCommand('exit 1', skillFolderPath, [], {
			bypassSecurity: true,
		});
		assert.notEqual(output.exitCode, 0);
	});

	it('clears stderr when exit code is 0', async () => {
		const output = await ScriptRunnerLocal.runCommand('echo hello', skillFolderPath, [], {
			bypassSecurity: true,
		});
		assert.equal(output.exitCode, 0);
		assert.equal(output.stderr, '');
	});

	it('captures stderr on non-zero exit', async () => {
		const output = await ScriptRunnerLocal.runCommand(
			'ls /path-skillet-test-nonexistent-xyz123',
			skillFolderPath,
			[],
			{ bypassSecurity: true },
		);
		assert.notEqual(output.exitCode, 0);
		assert.ok(output.stderr.length > 0, 'expected stderr to contain an error message');
	});

	it('times out long-running commands and sets timedOut flag', async () => {
		const output = await ScriptRunnerLocal.runCommand('sleep 10', skillFolderPath, [], {
			bypassSecurity: true,
			timeoutMs: 150,
		});
		assert.equal(output.timedOut, true);
	});
});
