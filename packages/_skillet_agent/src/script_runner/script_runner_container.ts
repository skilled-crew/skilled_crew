// node imports
import ChildProcess from 'node:child_process';
import Path from 'node:path';

// local imports
import { SkillDocAllowedTool } from '../config/skill/skill_types';
import { ScriptRunnerOutput } from './script_runner_types';
import { ScriptRunnerSecurity } from './script_runner_security';
import { ContainerHelper } from './container_helper';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class ScriptRunnerContainer {

	/**
	 * Run a script inside a running container instead of on the host.
	 * The container must have been provisioned by ContainerHelper.provision() and have
	 * the bot folder bind-mounted at ContainerHelper.botMountPath().
	 *
	 * @param commandLine The command line to execute (same shape as ScriptRunnerLocal).
	 * @param skillFolderPath Host absolute path to the skill folder. Translated to a
	 *                        container path by computing it relative to `botFolderPath`.
	 * @param allowedTools SKILL.md allowed-tools list.
	 * @param opts.containerName Target container (from ContainerHelper.containerName()).
	 * @param opts.botFolderPath Host absolute path to the bot root (bind-mount source).
	 */
	static async runCommand(
		commandLine: string,
		skillFolderPath: string,
		allowedTools: SkillDocAllowedTool[],
		{
			containerName,
			botFolderPath,
			timeoutMs = 30_000,
			bypassSecurity = false,
		}: {
			containerName: string;
			botFolderPath: string;
			timeoutMs?: number;
			bypassSecurity?: boolean;
		}
	): Promise<ScriptRunnerOutput> {
		if (bypassSecurity === false) {
			ScriptRunnerSecurity.checkCommandSecurity(commandLine, skillFolderPath);
			ScriptRunnerSecurity.checkAllowedTools(commandLine, allowedTools);
		}

		// translate the host skill folder path to the container path
		const skillRelToBot = Path.relative(botFolderPath, skillFolderPath);
		if (skillRelToBot.startsWith('..') || Path.isAbsolute(skillRelToBot)) {
			throw new Error(`Skill folder ${skillFolderPath} is outside bot folder ${botFolderPath}`);
		}
		const containerCwd = Path.posix.join(ContainerHelper.botMountPath(), skillRelToBot.split(Path.sep).join(Path.posix.sep));

		return new Promise<ScriptRunnerOutput>((resolve, reject) => {
			const child = ChildProcess.spawn(
				'docker',
				['exec', '-w', containerCwd, containerName, 'sh', '-c', commandLine],
				{ stdio: ['ignore', 'pipe', 'pipe'] },
			);

			let stdout = '';
			let stderr = '';
			let timedOut = false;

			const timeout = setTimeout(() => {
				timedOut = true;
				child.kill('SIGTERM');
			}, timeoutMs);

			child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
			child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

			child.on('error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});

			child.on('close', (exitCode) => {
				clearTimeout(timeout);

				// Mirror ScriptRunnerLocal: drop stderr on success to keep cached responses clean.
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
