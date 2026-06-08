// node imports
import ChildProcess from 'node:child_process';
import Fs from 'node:fs';
import Path from 'node:path';

// CONTAINER_PREFIX leaks into user-visible identifiers (container names, image
// names, volume names — `docker ps`, `docker volume ls`). Changing it orphans
// anyone's existing containers under the old prefix.
const CONTAINER_PREFIX = 'skillet';
// All bot folders are bind-mounted at the same path inside every container, so
// skill scripts can use relative paths (e.g. `../../_src/foo.ts`) that resolve
// identically on the host and in the container.
const BOT_MOUNT_PATH = '/bot';
// `_data/` is the convention for bot-managed persistent state. When present,
// it's overlaid by a per-user named volume so each user's reads/writes stay
// isolated. Generalizing to a configurable list is future work.
const PRIVATE_DATA_DIR = '_data';

/**
 * Lifecycle for per-(user, bot) Docker containers used by the container
 * script runtime. Owns image build, container provisioning, and matching
 * cleanup. The runner (`ScriptRunnerContainer`) only does `docker exec` —
 * everything that creates state lives here.
 */
export class ContainerHelper {

	static botMountPath(): string {
		return BOT_MOUNT_PATH;
	}

	static containerName(botId: string, userId: string): string {
		return `${CONTAINER_PREFIX}-${ContainerHelper._slugify(botId)}-${ContainerHelper._slugify(userId)}`;
	}

	static imageName(botId: string): string {
		return `${CONTAINER_PREFIX}-img-${ContainerHelper._slugify(botId)}`;
	}

	static nodeModulesVolumeName(botId: string, userId: string): string {
		return `${CONTAINER_PREFIX}-nm-${ContainerHelper._slugify(botId)}-${ContainerHelper._slugify(userId)}`;
	}

	static dataVolumeName(botId: string, userId: string): string {
		return `${CONTAINER_PREFIX}-data-${ContainerHelper._slugify(botId)}-${ContainerHelper._slugify(userId)}`;
	}

	/**
	 * Idempotent: build the image if missing, then run a long-lived container if not running.
	 * Bind-mounts the bot folder at `/bot`.
	 */
	static async provision(botFolderPath: string, botId: string, userId: string, dockerfilePath: string): Promise<void> {
		const image = ContainerHelper.imageName(botId);
		const container = ContainerHelper.containerName(botId, userId);

		// build the image if it doesn't exist yet
		const imageExists = await ContainerHelper._imageExists(image);
		if (imageExists === false) {
			// `-f` is given as an absolute path on purpose: docker resolves a relative
			// `-f` against the CLI's cwd, not the build context, which silently fails
			// when the runner is invoked from anywhere outside the bot folder.
			await ContainerHelper._run([
				'docker', 'build',
				'-t', image,
				'-f', dockerfilePath,
				botFolderPath,
			]);
		}

		// run the container if it's not already running
		const running = await ContainerHelper.isRunning(botId, userId);
		if (running === false) {
			// remove a stopped container with the same name (if any) before re-running
			await ContainerHelper._run(['docker', 'rm', '-f', container], { allowFailure: true });

			// Bind-mount the bot folder for live code/data, but keep image-installed
			// node_modules visible via a named volume that overlays the bind mount.
			const nodeModulesVolume = ContainerHelper.nodeModulesVolumeName(botId, userId);
			const runArgv = [
				'docker', 'run',
				'-d',
				'--name', container,
				'-v', `${botFolderPath}:${BOT_MOUNT_PATH}`,
				'-v', `${nodeModulesVolume}:${BOT_MOUNT_PATH}/node_modules`,
			];

			// If the bot has a `_data/` folder on the host, isolate it per-user via a
			// named volume mounted on top of the bind mount. The volume starts empty
			// (image has no /bot/_data content because the bot folder is bind-mounted,
			// not COPY'd), so each user begins with a clean `_data/`.
			if (Fs.existsSync(Path.join(botFolderPath, PRIVATE_DATA_DIR))) {
				const dataVolume = ContainerHelper.dataVolumeName(botId, userId);
				runArgv.push('-v', `${dataVolume}:${BOT_MOUNT_PATH}/${PRIVATE_DATA_DIR}`);
			}

			runArgv.push('-w', BOT_MOUNT_PATH, image);
			await ContainerHelper._run(runArgv);
		}
	}

	/**
	 * Destructive: removes the container AND both per-user volumes, including
	 * `_data/` — the user's persistent state for this bot is gone. Not called
	 * during normal provisioning; only via explicit cleanup.
	 */
	static async destroy(botId: string, userId: string): Promise<void> {
		const container = ContainerHelper.containerName(botId, userId);
		const nodeModulesVolume = ContainerHelper.nodeModulesVolumeName(botId, userId);
		const dataVolume = ContainerHelper.dataVolumeName(botId, userId);
		await ContainerHelper._run(['docker', 'rm', '-f', container], { allowFailure: true });
		await ContainerHelper._run(['docker', 'volume', 'rm', '-f', nodeModulesVolume], { allowFailure: true });
		await ContainerHelper._run(['docker', 'volume', 'rm', '-f', dataVolume], { allowFailure: true });
	}

	static async isRunning(botId: string, userId: string): Promise<boolean> {
		const container = ContainerHelper.containerName(botId, userId);
		const result = await ContainerHelper._run(
			['docker', 'inspect', '-f', '{{.State.Running}}', container],
			{ allowFailure: true },
		);
		if (result.exitCode !== 0) return false;
		return result.stdout.trim() === 'true';
	}

	///////////////////////////////////////////////////////////////////////////
	//
	///////////////////////////////////////////////////////////////////////////

	private static async _imageExists(image: string): Promise<boolean> {
		const result = await ContainerHelper._run(
			['docker', 'image', 'inspect', image],
			{ allowFailure: true },
		);
		return result.exitCode === 0;
	}

	// Docker rejects names with characters outside [a-zA-Z0-9_.-]. botId/userId
	// come from user input and the .skilled_crew.yaml `id:` field, so sanitize before
	// composing container/image/volume names.
	private static _slugify(value: string): string {
		return value.replace(/[^a-zA-Z0-9_-]/g, '_');
	}

	private static _run(
		argv: string[],
		{ allowFailure = false }: { allowFailure?: boolean } = {},
	): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
		return new Promise((resolve, reject) => {
			const [cmd, ...args] = argv;
			const child = ChildProcess.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
			child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
			child.on('error', (error) => {
				if (allowFailure === true) {
					resolve({ exitCode: null, stdout, stderr: stderr + String(error) });
					return;
				}
				reject(error);
			});
			child.on('close', (exitCode) => {
				if (exitCode !== 0 && allowFailure === false) {
					reject(new Error(`${argv.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`));
					return;
				}
				resolve({ exitCode, stdout, stderr });
			});
		});
	}
}
