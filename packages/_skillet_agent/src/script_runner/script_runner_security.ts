import Path from 'node:path';

import { SkillDocAllowedTool } from '../config/skill/skill_types';

export class ScriptRunnerSecurity {

	/**
	 * Reject shell metacharacters and path tokens that escape the crew sandbox.
	 * - Chaining/substitution: && || | ; $() backtick. A bare newline is also
	 *   chaining — EXCEPT when it opens a single-quoted heredoc body (see below).
	 * - Heredoc data: skills pass JSON/markdown containing quotes and apostrophes
	 *   on stdin via a quoted heredoc — e.g.
	 *     `npx tsx ../../_src/blackboard.ts write drafts - <<'JSON_END'`
	 *     `{ ...payload... }`
	 *     `JSON_END`
	 *   The body is fed to the child's stdin and never interpreted as shell, so it
	 *   is exempt from the chaining/path checks; only the command line that opens
	 *   the heredoc is validated. The delimiter MUST be quoted, which guarantees
	 *   the shell reads the body verbatim (no `$()`/backtick expansion).
	 * - Path tokens (any with `..` or an absolute path) must resolve INSIDE the
	 *   crew root. A skill command runs with the skill folder as cwd but may
	 *   legitimately reach the crew's shared files — e.g. `npx tsx ../../_src/x.ts`
	 *   from `<crewRoot>/skills/<name>`. Only escapes BEYOND the crew root (e.g.
	 *   `../../../../etc/passwd`, or an absolute path elsewhere on disk) are blocked.
	 */
	static checkCommandSecurity(commandLine: string, skillFolderPath: string): void {
		// Split off an optional heredoc body so its data is not mistaken for
		// command chaining. `inspectedCommand` is the command line with the heredoc
		// operator and body removed; a malformed/unsafe heredoc throws here.
		const inspectedCommand = ScriptRunnerSecurity._stripHeredoc(commandLine);

		const chainPatterns: { pattern: RegExp; label: string }[] = [
			{ pattern: /&&/, label: '&&' },
			{ pattern: /\|\|/, label: '||' },
			{ pattern: /\|/, label: '|' },
			{ pattern: /;/, label: ';' },
			{ pattern: /\$\(/, label: '$()' },
			{ pattern: /`/, label: 'backtick' },
			{ pattern: /\n/, label: 'newline' },
		];
		for (const { pattern, label } of chainPatterns) {
			if (pattern.test(inspectedCommand)) {
				throw new Error(`Command chaining is not allowed (found ${label}): ${commandLine}`);
			}
		}

		// Skills live at `<crewRoot>/skills/<name>`, so the crew root — which also
		// holds the shared `_src/` scripts a skill calls — is the skill folder's
		// grandparent. That is the sandbox boundary.
		const skillFolder = Path.resolve(skillFolderPath);
		const crewRoot = Path.resolve(skillFolder, '..', '..');

		const tokens = inspectedCommand.split(/\s+/);
		for (const token of tokens) {
			const unquoted = token.replace(/^['"]|['"]$/g, '');
			// Only `..` or absolute tokens can escape; a plain relative path always
			// resolves under cwd (the skill folder), which is inside the crew root.
			const couldEscape = unquoted.includes('..') || Path.isAbsolute(unquoted);
			if (couldEscape === false) {
				continue;
			}
			const resolved = Path.isAbsolute(unquoted)
				? Path.resolve(unquoted)
				: Path.resolve(skillFolder, unquoted);
			if (ScriptRunnerSecurity._isInside(resolved, crewRoot) === false) {
				throw new Error(`Path escapes the crew sandbox (${crewRoot}): ${token}`);
			}
		}
	}

	// True when `targetPath` is `rootPath` or nested inside it. The `+ sep` guard
	// stops a sibling-prefix from matching (e.g. `/a/bc` against root `/a/b`).
	private static _isInside(targetPath: string, rootPath: string): boolean {
		return targetPath === rootPath || targetPath.startsWith(rootPath + Path.sep);
	}

	/**
	 * If `commandLine` opens a heredoc, validate its structure and return the
	 * command line with the heredoc operator and body removed, so the caller's
	 * chaining/path checks see only the actual command. With no heredoc the input
	 * is returned unchanged.
	 *
	 * Only a single heredoc with a quoted delimiter is accepted — the form the
	 * skills use (`<<'JSON_END'`) and the only form where the shell treats the
	 * body as inert literal data. A newline that is not part of such a heredoc is
	 * left in place so the caller rejects it as command chaining. Throws on an
	 * unterminated heredoc or any command text after the closing delimiter (which
	 * the shell WOULD execute).
	 */
	private static _stripHeredoc(commandLine: string): string {
		const newlineIndex = commandLine.indexOf('\n');
		if (newlineIndex === -1) {
			return commandLine;
		}

		const firstLine = commandLine.slice(0, newlineIndex);
		const heredoc = ScriptRunnerSecurity._parseHeredocOpener(firstLine);
		if (heredoc === null) {
			// A newline with no heredoc opener is genuine chaining; leave it so the
			// caller's newline check fires.
			return commandLine;
		}

		const bodyLines = commandLine.slice(newlineIndex + 1).split('\n');
		const closeIndex = bodyLines.findIndex((line) => {
			const candidate = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;
			return candidate === heredoc.delimiter;
		});
		if (closeIndex === -1) {
			throw new Error(`Unterminated heredoc: missing closing delimiter "${heredoc.delimiter}"`);
		}

		const afterClose = bodyLines.slice(closeIndex + 1).join('\n').trim();
		if (afterClose.length > 0) {
			throw new Error(`Commands after a heredoc body are not allowed: ${afterClose}`);
		}

		// The body is inert stdin data; inspect only the command portion.
		return heredoc.commandWithoutOperator;
	}

	/**
	 * Parse a heredoc opener at the end of a command line. Returns the delimiter,
	 * whether `<<-` tab-stripping is in effect, and the command line with the
	 * operator removed — or null if the line opens no heredoc. An unquoted
	 * delimiter (`<<EOF`) is rejected: the shell would expand `$()`/backticks
	 * inside its body, which is about to be exempted from the checks.
	 */
	private static _parseHeredocOpener(
		firstLine: string,
	): { delimiter: string; stripTabs: boolean; commandWithoutOperator: string } | null {
		const quoted = firstLine.match(/<<(-?)\s*(['"])([^'"]+)\2\s*$/);
		if (quoted !== null) {
			return {
				delimiter: quoted[3],
				stripTabs: quoted[1] === '-',
				commandWithoutOperator: firstLine.slice(0, quoted.index).trim(),
			};
		}
		const unquoted = firstLine.match(/<<(-?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/);
		if (unquoted !== null) {
			throw new Error(
				`Heredoc delimiter must be quoted (use <<'${unquoted[2]}', not <<${unquoted[2]}) so the body is not shell-expanded`,
			);
		}
		return null;
	}

	/**
	 * Enforce the SKILL.md `allowed-tools` list — currently only `Bash(<cmd>:*)` is supported.
	 * Each allowed tool must declare args of the form `<cmd>:*`; the command line must start with `<cmd> `.
	 */
	static checkAllowedTools(commandLine: string, allowedTools: SkillDocAllowedTool[]): void {
		for (const allowedTool of allowedTools) {
			if (allowedTool.name === 'Bash') {
				if (allowedTool.args === undefined) {
					throw new Error(`Allowed tool ${allowedTool.name} must have args specifying the allowed command, e.g. "Bash(command:*)"`);
				}
				const allowedCommandName = allowedTool.args.split(':')[0];
				if (commandLine.startsWith(`${allowedCommandName} `) === false) {
					throw new Error(`Command ${commandLine} is not allowed. Allowed command: ${allowedCommandName}`);
				}
			} else {
				throw new Error(`Unsupported tool: ${allowedTool.name}`);
			}
		}
	}
}
