// node imports
import ChildProcess from 'node:child_process';

// local imports
import { SkillDocAllowedTool } from '../config/skill/skill_types';
import { ScriptRunnerOutput } from './script_runner_types';
import { ScriptRunnerSecurity } from './script_runner_security';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class ScriptRunnerLocal {

	/**
	 * Run a script within a skill folder
	 * @param commandLine The command line to execute
	 * @param skillFolderPath The path to the skill folder where the command should be executed
	 * @returns {Promise<ScriptRunnerOutput>} The result of the command execution, including exit code, stdout, stderr, and whether it timed out
	 */
	static async runCommand(
		commandLine: string,
		skillFolderPath: string,
		/**
		 * - specification https://agentskills.io/specification#allowed-tools-field
		 * - e.g.
		 * Bash(git:*) Bash(jq:*) Read
		 */
		allowedTools: SkillDocAllowedTool[],
		{
			timeoutMs = 30_000, // 30 seconds
			bypassSecurity = false, // for testing only - bypass all security checks and just run the command (use with caution)
		}: {
			timeoutMs?: number;
			bypassSecurity?: boolean;
		} = {}
	): Promise<ScriptRunnerOutput> {
		return new Promise<ScriptRunnerOutput>((resolve, reject) => {
			if (bypassSecurity === false) {
				ScriptRunnerSecurity.checkCommandSecurity(commandLine, skillFolderPath);
				ScriptRunnerSecurity.checkAllowedTools(commandLine, allowedTools);
			}

			/**
			 * NOTE: cwd if the skillFolderPath, because some command need to be run in the context of the skill (for example, if the command is "npm install", it need to be run in the skill folder to work)
			 */
			const child = ChildProcess.spawn(commandLine, {
				cwd: skillFolderPath,
				// NOTE: shell:true is required — skills rely on shell features the
				// runner depends on, notably heredocs (`<<'EOF'`) that pipe JSON to a
				// script's stdin. Safety does NOT come from avoiding the shell; it comes
				// from ScriptRunnerSecurity.checkCommandSecurity above, which rejects
				// command chaining/substitution and sandbox escapes before we spawn.
				shell: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});

			let stdout = '';
			let stderr = '';
			let timedOut = false;

			const timeout = setTimeout(() => {
				timedOut = true;
				child.kill('SIGTERM');
			}, timeoutMs);

			child.stdout.on('data', (chunk) => {
				stdout += chunk.toString();
			});

			child.stderr.on('data', (chunk) => {
				stderr += chunk.toString();
			});

			child.on('error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});

			child.on('close', (exitCode) => {
				clearTimeout(timeout);

				// KLUDGE: if exitCode is 0 then dont send the stderr.
				// - vscode send the js debugger 'Debugger listening on ws://127.0.0.1:56277/078249c5-ba9c-4d48-b594-04fd8829f3b0' in stderr
				// - it cause openai-cache to never cache it
				if (exitCode === 0) {
					resolve({
						exitCode,
						stdout: stdout.trim(),
						stderr: '',
						timedOut,
					});
					return;
				}

				resolve({
					exitCode,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
					timedOut,
				});
			});
		});
	}

}
