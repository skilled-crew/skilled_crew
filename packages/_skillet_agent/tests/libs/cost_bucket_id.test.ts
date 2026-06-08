import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fs from 'node:fs';
import Path from 'node:path';

import { CostBucketId } from '../../src/libs/cost_bucket_id';

describe('CostBucketId (#225)', () => {
	describe('build', () => {
		it('joins the namespace and parts into the canonical 4-segment path', () => {
			const bucketId = CostBucketId.build({
				userId: 'john@example.com',
				skilletId: 'news_brief',
				sessionId: 'jobid_abc_runid_xyz',
			});
			assert.equal(bucketId, 'tracker_bucket/john@example.com/news_brief/jobid_abc_runid_xyz');
		});

		it('round-trips through parse', () => {
			const parts = { userId: 'user_cli', skilletId: 'a', sessionId: 'jobid_abc_runid_xyz' };
			const parsed = CostBucketId.parse(CostBucketId.build(parts));
			assert.deepEqual(parsed, { namespace: CostBucketId.NAMESPACE, ...parts });
		});

		it('throws when userId contains a slash (would desync the per-user CLI grouping)', () => {
			assert.throws(
				() => CostBucketId.build({ userId: 'a/b', skilletId: 'news_brief', sessionId: 's' }),
				/userId.*must not contain/,
			);
		});

		it('throws when skilletId contains a slash', () => {
			assert.throws(
				() => CostBucketId.build({ userId: 'user_cli', skilletId: 'a/b', sessionId: 's' }),
				/skilletId.*must not contain/,
			);
		});

		it('does not guard sessionId (job lane always passes a slash-free jobId_runId)', () => {
			assert.doesNotThrow(() => CostBucketId.build({ userId: 'user_cli', skilletId: 'a', sessionId: 'jobid_abc_runid_xyz' }));
		});
	});

	describe('parse', () => {
		it('extracts the four fields from a canonical bucketId', () => {
			const parsed = CostBucketId.parse('tracker_bucket/user_cli/news_brief/jobid_abc_runid_xyz');
			assert.deepEqual(parsed, {
				namespace: 'tracker_bucket',
				userId: 'user_cli',
				skilletId: 'news_brief',
				sessionId: 'jobid_abc_runid_xyz',
			});
		});

		it('returns null for the default bucket (single segment)', () => {
			assert.equal(CostBucketId.parse(CostBucketId.DEFAULT_BUCKET), null);
		});

		it('returns null when the namespace does not match', () => {
			assert.equal(CostBucketId.parse('other_ns/user_cli/news_brief/sess'), null);
		});

		it('returns null when there are too many segments', () => {
			assert.equal(CostBucketId.parse('tracker_bucket/user_cli/news_brief/a/b'), null);
		});

		it('returns null when there are too few segments', () => {
			assert.equal(CostBucketId.parse('tracker_bucket/user_cli/news_brief'), null);
		});
	});

	describe('PATTERN stays in sync with the dev:cost:list npm script', () => {
		const packageJson = JSON.parse(
			Fs.readFileSync(
				Path.resolve(Path.dirname(new URL(import.meta.url).pathname), '../../package.json'),
				'utf8',
			),
		) as { scripts: Record<string, string> };

		for (const scriptName of ['dev:cost:list', 'dev:cost:list:watch']) {
			it(`'${scriptName}' uses CostBucketId.PATTERN as its -p value`, () => {
				assert.ok(
					packageJson.scripts[scriptName].includes(CostBucketId.PATTERN),
					`expected '${scriptName}' to contain pattern '${CostBucketId.PATTERN}', got: ${packageJson.scripts[scriptName]}`,
				);
			});
		}
	});
});
