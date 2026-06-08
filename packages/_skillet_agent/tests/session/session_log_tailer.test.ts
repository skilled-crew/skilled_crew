import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Os from 'node:os';
import Path from 'node:path';

import { SessionLogTailer } from '../../src/session/session_log_tailer';
import { SessionLogEntry } from '../../src/session/session_log_types';

function line(obj: unknown): string {
	return JSON.stringify(obj) + '\n';
}

async function collect(gen: AsyncGenerator<SessionLogEntry, void>): Promise<SessionLogEntry[]> {
	const out: SessionLogEntry[] = [];
	for await (const entry of gen) {
		out.push(entry);
	}
	return out;
}

describe('SessionLogTailer.follow', () => {
	let tmpDir: string;
	let filePath: string;
	beforeEach(() => {
		tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'skillet-tailer-test-'));
		filePath = Path.join(tmpDir, 'session.jsonl');
	});
	afterEach(() => {
		Fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('drains a finished log in one shot and skips malformed lines', async () => {
		Fs.writeFileSync(filePath,
			line({ kind: 'user_message', userInput: 'hi', timestamp: 't' }) +
			'this is not json\n' +
			line({ kind: 'final_result', finalResult: { text: 'done' }, timestamp: 't' }),
		);
		const out = await collect(SessionLogTailer.follow(filePath, { isDone: () => true, pollMs: 5 }));
		assert.deepEqual(out.map((e) => e.kind), ['user_message', 'final_result']);
	});

	it('follows a live append, then stops after a final drain', async () => {
		Fs.writeFileSync(filePath, line({ kind: 'step', stepResult: { type: 'text', text: 'a' }, timestamp: 't' }));
		// Drive the append from inside isDone so the test is timing-independent:
		// first poll reads line 1 then appends line 2; second poll reads line 2 then ends.
		let calls = 0;
		const isDone = async () => {
			calls += 1;
			if (calls === 1) {
				Fs.appendFileSync(filePath, line({ kind: 'final_result', finalResult: { text: 'b' }, timestamp: 't' }));
				return false;
			}
			return true;
		};
		const out = await collect(SessionLogTailer.follow(filePath, { isDone, pollMs: 5 }));
		assert.deepEqual(out.map((e) => e.kind), ['step', 'final_result']);
	});

	it('never yields a partial (newline-less) line until it is completed', async () => {
		Fs.writeFileSync(filePath,
			line({ kind: 'step', stepResult: { type: 'text', text: 'a' }, timestamp: 't' }) +
			'{"kind":"step","stepResult":{"type":"text","text":"b"}',  // no trailing newline yet
		);
		let calls = 0;
		const isDone = async () => {
			calls += 1;
			if (calls === 1) {
				Fs.appendFileSync(filePath, ',"timestamp":"t"}\n');  // complete the dangling line
				return false;
			}
			return true;
		};
		const out = await collect(SessionLogTailer.follow(filePath, { isDone, pollMs: 5 }));
		assert.equal(out.length, 2, 'the partial line must surface only once completed');
		assert.deepEqual(out.map((e) => e.kind), ['step', 'step']);
	});

	it('treats a not-yet-created file as empty (no throw)', async () => {
		const missing = Path.join(tmpDir, 'does-not-exist.jsonl');
		const out = await collect(SessionLogTailer.follow(missing, { isDone: () => true, pollMs: 5 }));
		assert.equal(out.length, 0);
	});

	it('stops promptly when the consumer aborts (run never ends on its own)', async () => {
		Fs.writeFileSync(filePath, line({ kind: 'step', stepResult: { type: 'text', text: 'a' }, timestamp: 't' }));
		let aborted = false;
		setTimeout(() => { aborted = true; }, 20);
		const out = await collect(SessionLogTailer.follow(filePath, {
			isDone: () => false,           // would otherwise tail forever
			isAborted: () => aborted,
			pollMs: 5,
		}));
		assert.equal(out.length, 1, 'reads what exists, then exits on abort instead of hanging');
	});
});
