import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';
import { AiSessionStore } from '../../src/session/ai_session_store';

type TestItem = { role: string; content: string };

describe('AiSessionStore', () => {
	let dbFilePath: string;
	let tmpDir: string;
	let store: AiSessionStore;

	beforeEach(async () => {
		tmpDir = await Fs.promises.mkdtemp(Path.join(Os.tmpdir(), 'skillet-session-test-'));
		dbFilePath = Path.join(tmpDir, 'test.db');
		store = new AiSessionStore(dbFilePath);
	});

	afterEach(async () => {
		await store.close();
		await Fs.promises.rm(tmpDir, { recursive: true, force: true });
	});

	it('creates store without errors and DB file exists', async () => {
		const stats = await Fs.promises.stat(dbFilePath);
		assert.ok(stats.isFile());
	});

	it('saves and retrieves conversation items (round-trip)', async () => {
		const session = await store.getOpenAiSession('user1', 'session1');
		const item: TestItem = { role: 'user', content: 'hello' };
		await session.addItems([item] as never[]);
		const retrieved = await session.getItems();
		assert.equal(retrieved.length, 1);
		assert.deepEqual(retrieved[0] as unknown as TestItem, item);
	});

	it('returns empty array for non-existent session', async () => {
		const session = await store.getOpenAiSession('user1', 'empty-session');
		const items = await session.getItems();
		assert.deepEqual(items, []);
	});

	it('keeps multiple sessions isolated with no cross-contamination', async () => {
		const session1 = await store.getOpenAiSession('user1', 'session-a');
		const session2 = await store.getOpenAiSession('user1', 'session-b');

		await session1.addItems([{ role: 'user', content: 'from A' }] as never[]);
		await session2.addItems([{ role: 'user', content: 'from B' }] as never[]);

		const items1 = await session1.getItems();
		const items2 = await session2.getItems();
		assert.equal(items1.length, 1);
		assert.equal(items2.length, 1);
		assert.equal((items1[0] as unknown as TestItem).content, 'from A');
		assert.equal((items2[0] as unknown as TestItem).content, 'from B');
	});

	it('deletes a session and removes all its items', async () => {
		const session = await store.getOpenAiSession('user1', 'to-delete');
		await session.addItems([{ role: 'user', content: 'goodbye' }] as never[]);
		await store.deleteSession('user1', 'to-delete');
		const items = await session.getItems();
		assert.deepEqual(items, []);
	});

	it('retrieves session names for a user', async () => {
		const sessionA = await store.getOpenAiSession('user2', 'alpha');
		const sessionB = await store.getOpenAiSession('user2', 'beta');
		await sessionA.addItems([{ role: 'user', content: 'a' }] as never[]);
		await sessionB.addItems([{ role: 'user', content: 'b' }] as never[]);

		const names = await store.getSessionNamesForUser('user2');
		assert.ok(names.includes('alpha'));
		assert.ok(names.includes('beta'));
	});

	it('pops the most recently inserted item', async () => {
		const session = await store.getOpenAiSession('user1', 'pop-test');
		await session.addItems([
			{ role: 'user', content: 'first' },
			{ role: 'user', content: 'second' },
		] as never[]);

		const popped = await session.popItem();
		assert.ok(popped !== undefined);
		assert.equal((popped as unknown as TestItem).content, 'second');

		const remaining = await session.getItems();
		assert.equal(remaining.length, 1);
		assert.equal((remaining[0] as unknown as TestItem).content, 'first');
	});

	it('returns undefined when popping from an empty session', async () => {
		const session = await store.getOpenAiSession('user1', 'empty-pop');
		const popped = await session.popItem();
		assert.equal(popped, undefined);
	});

	it('clears the session removing all items', async () => {
		const session = await store.getOpenAiSession('user1', 'clear-test');
		await session.addItems([{ role: 'user', content: 'to be cleared' }] as never[]);
		await session.clearSession();
		const items = await session.getItems();
		assert.deepEqual(items, []);
	});

	it('returns correct session ID combining user and session name', async () => {
		const session = await store.getOpenAiSession('user1', 'my-session');
		const sessionId = await session.getSessionId();
		assert.equal(sessionId, 'user1:my-session');
	});

	it('persists data across close and reopen', async () => {
		const session = await store.getOpenAiSession('user1', 'persist-test');
		await session.addItems([{ role: 'user', content: 'persisted data' }] as never[]);

		await store.close();

		const freshStore = new AiSessionStore(dbFilePath);
		const freshSession = await freshStore.getOpenAiSession('user1', 'persist-test');
		const items = await freshSession.getItems();
		await freshStore.close();

		store = new AiSessionStore(dbFilePath);

		assert.equal(items.length, 1);
		assert.equal((items[0] as unknown as TestItem).content, 'persisted data');
	});
});
