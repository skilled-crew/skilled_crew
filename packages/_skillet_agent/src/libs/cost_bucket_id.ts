///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	CostBucketId — single source of truth for the openai-cost tracker bucketId
//	format. Every producer builds its bucketId through `build()` and the cost
//	rollup parses it through `parse()`, so the path layout lives in exactly one
//	place and can never drift. This mirrors how `UtilsAi.costTrackerDbPath()`
//	centralizes the tracker DB *path* "so they can never drift" (#189). See #225.
//
//	Wire format (kept byte-identical to the historical literal so existing tracker
//	DBs and the `dev:cost:list` openai_cost_pp pattern keep working):
//		tracker_bucket/<userId>/<skilletId>/<sessionId>
//	In the job lane the trailing segment is `<jobId>_<runId>` — see
//	`JobLaneSession.sessionNameForRun`.
//
//	openai-cost@1.0.32 ships `OpenAiSqliteBucketPatternHelper` for exactly this
//	shape, but its `package.json` `exports` map exposes only "." and the root
//	index does not re-export the helper, so it cannot be imported here. The
//	build/parse below are the small local equivalent; if the package later exports
//	the helper from its root, this can delegate to it instead.
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

/** The parts that make up a cost bucketId (everything after the namespace). */
export type CostBucketParts = {
	userId: string;
	skilletId: string;
	sessionId: string;
};

/** A parsed cost bucketId, including the leading namespace segment. */
export type CostBucketIdParsed = CostBucketParts & {
	namespace: string;
};

export class CostBucketId {
	/** Literal first path segment. Maps to the `{namespace}` variable of the
	 * `openai_cost_pp` pattern used by the `dev:cost:list` npm script. */
	static readonly NAMESPACE = 'tracker_bucket';

	/** Bucket used when a caller does not attribute its spend to a specific run. */
	static readonly DEFAULT_BUCKET = 'default_bucket';

	/** Number of `/`-delimited segments a well-formed bucketId has. */
	static readonly SEGMENT_COUNT = 4;

	/** Canonical `openai_cost_pp` pattern. MUST stay equal to the `-p` value in the
	 * `dev:cost:list` / `dev:cost:list:watch` scripts in package.json so the
	 * in-code rollup and the CLI grouping never diverge. */
	static readonly PATTERN = '{namespace}/{userId}/{skilletId}/{sessionId}';

	/**
	 * Build a cost bucketId from its parts.
	 *
	 * `userId` and `skilletId` are fixed-position segments that the per-user /
	 * per-skillet CLI grouping keys on, so a `/` in either would add spurious
	 * segments and desync that grouping from the per-run rollup. We fail loud
	 * rather than silently miscost (#225). `sessionId` is the trailing segment and
	 * is intentionally not guarded — the job lane always passes a slash-free
	 * `<jobId>_<runId>`, and a chat-mode session name keeps its existing behaviour.
	 */
	static build(parts: CostBucketParts): string {
		for (const field of ['userId', 'skilletId'] as const) {
			if (parts[field].includes('/') === true) {
				throw new Error(`CostBucketId.build: '${field}' must not contain '/': got '${parts[field]}'`);
			}
		}
		return [CostBucketId.NAMESPACE, parts.userId, parts.skilletId, parts.sessionId].join('/');
	}

	/**
	 * Parse a cost bucketId into its parts, or return null when it does not match
	 * the canonical 4-segment `tracker_bucket/...` shape (e.g. the `DEFAULT_BUCKET`,
	 * or a bucket written by some other tool). Callers skip unparseable buckets
	 * rather than guessing.
	 */
	static parse(bucketId: string): CostBucketIdParsed | null {
		const segments = bucketId.split('/');
		if (segments.length !== CostBucketId.SEGMENT_COUNT) {
			return null;
		}
		const [namespace, userId, skilletId, sessionId] = segments;
		if (namespace !== CostBucketId.NAMESPACE) {
			return null;
		}
		return { namespace, userId, skilletId, sessionId };
	}
}
