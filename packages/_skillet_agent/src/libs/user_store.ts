// node imports
import Path from 'node:path';
import { fileURLToPath } from 'node:url';

// npm imports
import BetterSqlite3 from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

// local imports
import { SkilletPaths } from './skillet_paths';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Types
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export type UserRecord = {
	id: string;
	email: string;
	displayName: string;
	avatarUrl: string | null;
	passwordHash: string | null;
	authProvider: 'google' | 'local';
	isAdmin: boolean;
	createdAt: number;
};

type UserRow = {
	id: string;
	email: string;
	display_name: string;
	avatar_url: string | null;
	password_hash: string | null;
	auth_provider: string;
	is_admin: number;
	created_at: number;
};

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	UserStore class
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

const BCRYPT_SALT_ROUNDS = 12;

export class UserStore {
	private _sqliteDb: BetterSqlite3.Database;

	/** Email of the seeded default user. Single source of truth for the CLI's
	 * `--user-email` default and the web's job-worker session-log lookup, so the
	 * identity a worker writes under and the one the web reads back never drift. */
	static readonly DEFAULT_USER_EMAIL = 'john@example.com';

	/** Profile fields applied when the default user is first seeded by
	 * {@link ensureDefaultUser}. The password is intentionally well-known: it is a
	 * local-development convenience and matches the web client login and the
	 * Playwright auth setup. */
	static readonly DEFAULT_USER_DISPLAY_NAME = 'John Doe';
	static readonly DEFAULT_USER_PASSWORD = 'weakPassword';
	static readonly DEFAULT_USER_AVATAR_URL = '/_assets/images/jetienne-avatar.jpg';

	/** Absolute path to the shared user-store SQLite, resolved through
	 * {@link SkilletPaths.userStoreDb} (the agent state dir's `.user_store.sqlite`,
	 * e.g. `.skilled-agent/state/.user_store.sqlite` in a checkout) regardless of
	 * the caller's cwd — so the webclient and CLI both open the exact same database
	 * file. */
	static defaultDbPath(): string {
		return SkilletPaths.userStoreDb();
	}

	constructor(dbFilePath: string) {
		this._sqliteDb = new BetterSqlite3(dbFilePath);

		this._sqliteDb.exec(`
			CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY,
				email TEXT UNIQUE NOT NULL,
				display_name TEXT NOT NULL,
				avatar_url TEXT,
				password_hash TEXT,
				auth_provider TEXT NOT NULL,
				is_admin INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL
			);
		`);
	}

	close(): void {
		this._sqliteDb.close();
	}

	getSqliteDatabase(): BetterSqlite3.Database {
		return this._sqliteDb;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Query methods
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	findById(id: string): UserRecord | null {
		const row = this._sqliteDb.prepare(`
			SELECT * FROM users WHERE id = ?
		`).get(id) as UserRow | undefined;

		if (row === undefined) return null;
		return UserStore._rowToRecord(row);
	}

	findByEmail(email: string): UserRecord | null {
		const row = this._sqliteDb.prepare(`
			SELECT * FROM users WHERE email = ?
		`).get(email) as UserRow | undefined;

		if (row === undefined) return null;
		return UserStore._rowToRecord(row);
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Mutation methods
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	async createLocalUser({
		email, displayName, password, isAdmin = false
	}: {
		email: string, displayName: string, password: string, isAdmin?: boolean
	}): Promise<UserRecord> {
		const id = uuidv4();
		const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
		const createdAt = Date.now();

		this._sqliteDb.prepare(`
			INSERT INTO users (id, email, display_name, avatar_url, password_hash, auth_provider, is_admin, created_at)
			VALUES (?, ?, ?, NULL, ?, 'local', ?, ?)
		`).run(id, email, displayName, passwordHash, isAdmin ? 1 : 0, createdAt);

		return {
			id,
			email,
			displayName,
			avatarUrl: null,
			passwordHash,
			authProvider: 'local',
			isAdmin,
			createdAt,
		};
	}

	upsertGoogleUser(googleProfile: { id: string; displayName: string; photos?: Array<{ value: string }>; emails?: Array<{ value: string }> }): UserRecord {
		const existing = this.findById(googleProfile.id);

		const email = googleProfile.emails?.[0]?.value ?? '';
		const avatarUrl = googleProfile.photos?.[0]?.value ?? null;
		const displayName = googleProfile.displayName;

		if (existing !== null) {
			this._sqliteDb.prepare(`
				UPDATE users SET email = ?, display_name = ?, avatar_url = ? WHERE id = ?
			`).run(email, displayName, avatarUrl, googleProfile.id);

			return {
				...existing,
				email,
				displayName,
				avatarUrl,
			};
		}

		const createdAt = Date.now();
		this._sqliteDb.prepare(`
			INSERT INTO users (id, email, display_name, avatar_url, password_hash, auth_provider, is_admin, created_at)
			VALUES (?, ?, ?, ?, NULL, 'google', 0, ?)
		`).run(googleProfile.id, email, displayName, avatarUrl, createdAt);

		return {
			id: googleProfile.id,
			email,
			displayName,
			avatarUrl,
			passwordHash: null,
			authProvider: 'google',
			isAdmin: false,
			createdAt,
		};
	}

	/**
	 * Seed the default local user on first call and return it on every call
	 * thereafter. Idempotent, so it is safe to invoke on each CLI launch to give a
	 * fresh checkout a usable identity without a manual seed step (issue #261).
	 *
	 * If a concurrent process wins the insert race (the UNIQUE email constraint
	 * fires), the now-present record is fetched and returned rather than thrown.
	 */
	async ensureDefaultUser(): Promise<UserRecord> {
		const existing = this.findByEmail(UserStore.DEFAULT_USER_EMAIL);
		if (existing !== null) return existing;

		try {
			const user = await this.createLocalUser({
				email: UserStore.DEFAULT_USER_EMAIL,
				displayName: UserStore.DEFAULT_USER_DISPLAY_NAME,
				password: UserStore.DEFAULT_USER_PASSWORD,
				isAdmin: true,
			});

			this._sqliteDb.prepare(`
				UPDATE users SET avatar_url = ? WHERE id = ?
			`).run(UserStore.DEFAULT_USER_AVATAR_URL, user.id);

			return { ...user, avatarUrl: UserStore.DEFAULT_USER_AVATAR_URL };
		} catch (error) {
			const seeded = this.findByEmail(UserStore.DEFAULT_USER_EMAIL);
			if (seeded !== null) return seeded;
			throw error;
		}
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Password verification
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	async verifyPassword(userRecord: UserRecord, password: string): Promise<boolean> {
		if (userRecord.passwordHash === null) return false;
		return bcrypt.compare(password, userRecord.passwordHash);
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	Private helpers
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	private static _rowToRecord(row: UserRow): UserRecord {
		return {
			id: row.id,
			email: row.email,
			displayName: row.display_name,
			avatarUrl: row.avatar_url,
			passwordHash: row.password_hash,
			authProvider: row.auth_provider as 'google' | 'local',
			isAdmin: row.is_admin === 1,
			createdAt: row.created_at,
		};
	}
}

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

async function main() {
	const userStore = new UserStore(UserStore.defaultDbPath());
	const user = await userStore.ensureDefaultUser();
	userStore.close();
	console.log(`Default user ready: ${user.email} (id ${user.id}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}