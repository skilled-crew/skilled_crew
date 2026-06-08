import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import { UserStore } from '../../src/libs/user_store';

describe('UserStore.ensureDefaultUser', () => {
	let tmpDir: string;
	let dbFilePath: string;
	let store: UserStore;

	beforeEach(async () => {
		tmpDir = await Fs.promises.mkdtemp(Path.join(Os.tmpdir(), 'skillet-user-store-test-'));
		dbFilePath = Path.join(tmpDir, 'user_store.sqlite');
		store = new UserStore(dbFilePath);
	});

	afterEach(async () => {
		store.close();
		await Fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it('creates the default user when the store is empty', async () => {
		assert.equal(store.findByEmail(UserStore.DEFAULT_USER_EMAIL), null);

		const user = await store.ensureDefaultUser();

		assert.equal(user.email, UserStore.DEFAULT_USER_EMAIL);
		assert.equal(user.displayName, UserStore.DEFAULT_USER_DISPLAY_NAME);
		assert.equal(user.avatarUrl, UserStore.DEFAULT_USER_AVATAR_URL);
		assert.equal(user.authProvider, 'local');
		assert.equal(user.isAdmin, true);
	});

	it('persists the created user so a later lookup by email returns it', async () => {
		const created = await store.ensureDefaultUser();
		const found = store.findByEmail(UserStore.DEFAULT_USER_EMAIL);

		assert.notEqual(found, null);
		assert.equal(found?.id, created.id);
		assert.equal(found?.avatarUrl, UserStore.DEFAULT_USER_AVATAR_URL);
		assert.equal(found?.isAdmin, true);
	});

	it('is idempotent: a second call returns the same record without duplicating', async () => {
		const first = await store.ensureDefaultUser();
		const second = await store.ensureDefaultUser();

		assert.equal(second.id, first.id);

		const row = store.getSqliteDatabase()
			.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?')
			.get(UserStore.DEFAULT_USER_EMAIL) as { count: number };
		assert.equal(row.count, 1);
	});

	it('seeds a password that verifies against the known default credential', async () => {
		const user = await store.ensureDefaultUser();

		assert.equal(await store.verifyPassword(user, UserStore.DEFAULT_USER_PASSWORD), true);
		assert.equal(await store.verifyPassword(user, 'wrongPassword'), false);
	});
});
