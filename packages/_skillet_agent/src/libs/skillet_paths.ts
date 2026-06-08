// node imports
import Os from 'node:os';
import Fs from 'node:fs';
import Path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = Path.dirname(fileURLToPath(import.meta.url));
// This file lives at <package_root>/src/libs (→ <package_root>/dist/libs at
// runtime); two levels up is the package root in both layouts.
const PACKAGE_ROOT = Path.resolve(MODULE_DIR, '..', '..');

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	SkilletPaths — single resolver for every runtime path.
//
//	Three roles, resolved by ONE rule (see _role):
//	  1. $SKILLET_HOME/<role>                       if SKILLET_HOME is set
//	  2. <checkout root>/.skilled-agent/<role>      when run from a git checkout
//	  3. ${XDG_<ROLE>_HOME:-default}/skilled-crew   otherwise (installed → XDG)
//
//	`config` holds user-authored crews, `state` holds the databases / session
//	logs / REPL history, `cache` holds the disposable response cache. Branches
//	1-2 keep all three under one base (development, CI, worker pinning); branch 3
//	follows the XDG Base Directory spec when the CLI is installed via npm.
//
//	process.env is read lazily on every call, so a process that sets the
//	variables after this module is imported still resolves correctly. Bundled
//	sample data ships per-package (each package resolves its own `data/`) and is
//	deliberately NOT handled here.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class SkilletPaths {
	static readonly ENV_VAR_HOME = 'SKILLET_HOME';

	/** User-authored crews; overlays each package's bundled samples at read time. */
	static configDir(): string {
		return SkilletPaths._role('config', 'XDG_CONFIG_HOME', '.config');
	}

	/** Persistent runtime state: databases, session logs, REPL history. */
	static stateDir(): string {
		return SkilletPaths._role('state', 'XDG_STATE_HOME', Path.join('.local', 'state'));
	}

	/** Disposable cache; safe to delete at any time. */
	static cacheDir(): string {
		return SkilletPaths._role('cache', 'XDG_CACHE_HOME', '.cache');
	}

	static agentSessionsDb(): string {
		return Path.join(SkilletPaths.stateDir(), '.agent_sessions.sqlite');
	}

	static costTrackerDb(): string {
		return Path.join(SkilletPaths.stateDir(), '.openai_cost_tracker.sqlite');
	}

	static userStoreDb(): string {
		return Path.join(SkilletPaths.stateDir(), '.user_store.sqlite');
	}

	static jobsDb(): string {
		return Path.join(SkilletPaths.stateDir(), '.skillet_jobs.sqlite');
	}

	static webSessionsDb(): string {
		return Path.join(SkilletPaths.stateDir(), '.web_sessions.sqlite');
	}

	static webChatHandlesDb(): string {
		return Path.join(SkilletPaths.stateDir(), '.web_chat_handles.sqlite');
	}

	static agentSessionLogsDir(): string {
		return Path.join(SkilletPaths.stateDir(), '.agent_session_logs');
	}

	static readlineHistory(name: string): string {
		return Path.join(SkilletPaths.stateDir(), `.readline_history_${name}.json`);
	}

	static openaiCacheDb(): string {
		return Path.join(SkilletPaths.cacheDir(), '.openai_cache.sqlite');
	}

	/**
	 * The single base when running unified (SKILLET_HOME, or a git checkout in
	 * development), or `null` when installed (roles are XDG-scattered). The
	 * dispatcher pins this onto worker subprocesses so a worker loaded from
	 * node_modules resolves the dispatcher's directories, not its own.
	 */
	static unifiedBase(): string | null {
		const home = process.env[SkilletPaths.ENV_VAR_HOME];
		if (home !== undefined && home !== '') {
			return Path.resolve(home);
		}
		if (SkilletPaths._isInstalled() === false) {
			return Path.join(SkilletPaths._checkoutRoot(), '.skilled-agent');
		}
		return null;
	}

	/** The one rule, parameterized by role. The only dev-vs-installed branch. */
	private static _role(role: string, xdgVar: string, xdgFallback: string): string {
		const base = SkilletPaths.unifiedBase();
		if (base !== null) {
			return SkilletPaths._ensure(Path.join(base, role));
		}
		const xdgRoot = process.env[xdgVar];
		const root = (xdgRoot !== undefined && xdgRoot !== '')
			? Path.resolve(xdgRoot)
			: Path.join(Os.homedir(), xdgFallback);
		return SkilletPaths._ensure(Path.join(root, 'skilled-crew'));
	}

	private static _isInstalled(): boolean {
		return PACKAGE_ROOT.split(Path.sep).includes('node_modules');
	}

	private static _checkoutRoot(): string {
		let dir = PACKAGE_ROOT;
		while (dir !== Path.dirname(dir)) {
			if (Fs.existsSync(Path.join(dir, '.git')) === true) {
				return dir;
			}
			dir = Path.dirname(dir);
		}
		return PACKAGE_ROOT;
	}

	private static _ensure(dir: string): string {
		Fs.mkdirSync(dir, { recursive: true });
		return dir;
	}
}
