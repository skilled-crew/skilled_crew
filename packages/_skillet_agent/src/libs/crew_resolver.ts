// node imports
import Fs from 'node:fs';
import Path from 'node:path';

// npm imports
import YAML from 'yaml';

// local imports
import { SkilletPaths } from './skillet_paths';

/** A discoverable crew: its `skilletId` and the absolute path to its `.skilled_crew.yaml`. */
export type CrewEntry = {
	id: string;
	path: string;
};

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	CrewResolver — resolve the `-c` value of `run`/`chat` to a concrete crew file.
//
//	The value is either a filesystem path or a skilletId. One rule, and the
//	"no -c" case is not special: the CLI defaults the value to DEFAULT_SKILLET_ID
//	and feeds it through `resolve` unchanged.
//
//	  1. an existing file  → used as-is (today's behavior)
//	  2. otherwise         → the bundled/user crew whose `id` matches the value
//
//	Crews are discovered from the package's bundled `data/skillets` and from the
//	user config directory; a user crew wins over a bundled crew on an id clash.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class CrewResolver {
	/** skilletId used when the user passes no `-c` at all. */
	static readonly DEFAULT_SKILLET_ID = 'todo_list';

	private static readonly CREW_FILE_SUFFIX = '.skilled_crew.yaml';

	/** Resolve a path-or-skilletId to an absolute `.skilled_crew.yaml` path. */
	static resolve(pathOrId: string): string {
		if (CrewResolver._isExistingFile(pathOrId) === true) {
			return Path.resolve(pathOrId);
		}

		const available = CrewResolver.listAvailable();
		const match = available.find((crew) => crew.id === pathOrId);
		if (match !== undefined) {
			return match.path;
		}

		const ids = available.map((crew) => crew.id).sort();
		const idsText = ids.length > 0 ? ids.join(', ') : '(none found)';
		throw new Error(
			`no crew found for "${pathOrId}": not an existing file, and no bundled or user crew has that skilletId. Available ids: ${idsText}`,
		);
	}

	/**
	 * Every discoverable crew as `{ id, path }`. Bundled crews are listed first
	 * and user crews second, so a user crew overrides a bundled crew that shares
	 * the same id.
	 */
	static listAvailable(): CrewEntry[] {
		const bundledCrews = CrewResolver._discover(Path.join(SkilletPaths.bundledConfigDir(), 'skillets'));
		const userCrews = CrewResolver._discover(SkilletPaths.configDir());

		const byId = new Map<string, CrewEntry>();
		for (const crew of bundledCrews) {
			byId.set(crew.id, crew);
		}
		for (const crew of userCrews) {
			byId.set(crew.id, crew);
		}
		return [...byId.values()];
	}

	private static _isExistingFile(candidate: string): boolean {
		try {
			return Fs.statSync(candidate).isFile() === true;
		} catch {
			return false;
		}
	}

	/** Recursively collect crew files under `rootDir`, skipping `evals/` fixtures. */
	private static _discover(rootDir: string): CrewEntry[] {
		if (Fs.existsSync(rootDir) === false) {
			return [];
		}

		const crews: CrewEntry[] = [];
		const dirents = Fs.readdirSync(rootDir, { recursive: true, withFileTypes: true });
		for (const dirent of dirents) {
			if (dirent.isFile() === false) {
				continue;
			}
			if (dirent.name.endsWith(CrewResolver.CREW_FILE_SUFFIX) === false) {
				continue;
			}
			if (dirent.parentPath.split(Path.sep).includes('evals') === true) {
				continue;
			}

			const filePath = Path.join(dirent.parentPath, dirent.name);
			const id = CrewResolver._readSkilletId(filePath);
			if (id !== null) {
				crews.push({ id: id, path: filePath });
			}
		}
		return crews;
	}

	/** Read just the `id` field of a crew file; null if absent or unparseable. */
	private static _readSkilletId(filePath: string): string | null {
		try {
			const parsed = YAML.parse(Fs.readFileSync(filePath, 'utf8')) as { id?: unknown };
			if (typeof parsed?.id === 'string') {
				return parsed.id;
			}
			return null;
		} catch {
			return null;
		}
	}
}
