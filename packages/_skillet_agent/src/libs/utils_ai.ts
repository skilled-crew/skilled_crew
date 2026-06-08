// npm imports
// FIXME what is this weird 'openai/index.js' ???
import { OpenAI } from 'openai/index.js';
import { Cacheable } from 'cacheable';
import OpenAICache from 'openai-cache';
import KeyvSqlite from '@keyv/sqlite';

// local imports
import { OpenAICallTracker, OpenAiCostTrackerSqlite } from 'openai-cost';
import type { OpenAICallTrackerCallback } from 'openai-cost';
import { CostBucketId } from './cost_bucket_id';
import { SkilletPaths } from './skillet_paths';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export type UtilsAiProvider = 'openai' | 'lmstudio';

export type ProviderModelSpec = {
	provider: UtilsAiProvider;
	modelName: string;
};

export class UtilsAi {
	static PROVIDER = {
		OPENAI: 'openai' as UtilsAiProvider,
		LMSTUDIO: 'lmstudio' as UtilsAiProvider,
	}

	static SUPPORTED_PROVIDERS: UtilsAiProvider[] = ['openai', 'lmstudio'];

	// Single source of truth for the openai-cost tracker SQLite path. Both the
	// client wiring (which writes it) and the job-lane cost rollup (which reads
	// it) resolve the file through here so they can never drift (#189).
	static costTrackerDbPath(): string {
		return SkilletPaths.costTrackerDb();
	}

	static parseProviderModel(spec: string): ProviderModelSpec {
		const slashIndex = spec.indexOf('/');
		if (slashIndex === -1) {
			throw new Error(
				`Invalid model spec '${spec}': expected '<provider>/<model>' (e.g. 'openai/gpt-4.1-nano', 'lmstudio/liquid/lfm2-1.2b'). Supported providers: ${UtilsAi.SUPPORTED_PROVIDERS.join(', ')}.`,
			);
		}
		const providerRaw = spec.slice(0, slashIndex);
		const modelName = spec.slice(slashIndex + 1);
		if (modelName === '') {
			throw new Error(
				`Invalid model spec '${spec}': model id after '${providerRaw}/' is empty. Expected '<provider>/<model>'.`,
			);
		}
		const isKnownProvider = UtilsAi.SUPPORTED_PROVIDERS.includes(providerRaw as UtilsAiProvider);
		if (isKnownProvider === false) {
			throw new Error(
				`Unknown provider '${providerRaw}' in model spec '${spec}'. Supported providers: ${UtilsAi.SUPPORTED_PROVIDERS.join(', ')}.`,
			);
		}
		return {
			provider: providerRaw as UtilsAiProvider,
			modelName,
		};
	}

	static async getOpenAiClient({
		provider = UtilsAi.PROVIDER.OPENAI,
		bucketId = CostBucketId.DEFAULT_BUCKET,
	}: {
		provider?: UtilsAiProvider;
		bucketId?: string;
	} = {}): Promise<OpenAI> {

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Init openai-cache
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// init a cacheable instance
		// - here it is backed by a sqlite database, but you can use any Keyv storage backend (redis, filesystem, etc)
		const sqlitePath = `sqlite://${SkilletPaths.openaiCacheDb()}`;
		const sqliteCache = new Cacheable({ secondary: new KeyvSqlite(sqlitePath) });

		// init the OpenAICache with the cacheable instance
		const openaiCache = new OpenAICache(sqliteCache, {
			markResponseEnabled: true, // this will add a custom header to the response to indicate if it was from the cache or not
			// verboseLevel: 2, // this will log cache hits and misses to the console, set to 0 to disable all logging, 1 for basic logging, 2 for detailed logging
		});

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	init the tracker sqlite to store tracked costs from the OpenAICallTracker
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// init the tracker SQLite to store tracked costs from the OpenAICallTracker
		const dbFilePath = UtilsAi.costTrackerDbPath();
		const trackerSqlite = new OpenAiCostTrackerSqlite(dbFilePath);
		await trackerSqlite.init();

		// Build the fetch function with tracking capabilities, using the OpenAICache
		// fetch as the original fetch implementation. getFetchFn invokes the tracker
		// callback fire-and-forget (it is intentionally NOT awaited so the real
		// response streams immediately), so a rejecting callback has nothing to catch
		// it and surfaces as a process-level unhandledRejection. Cost tracking is
		// best-effort observability — wrap the callback so a tracking failure is logged
		// loudly but can never crash the host process (e.g. take down the multi-user
		// web server mid-stream). See issue #202.
		const rawTrackerCallback = await trackerSqlite.getTrackerCallback();
		const safeTrackerCallback: OpenAICallTrackerCallback = async (callbackBucketId, input, init, response) => {
			try {
				await rawTrackerCallback(callbackBucketId, input, init, response);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[openai-cost] cost tracking skipped (non-fatal): ${message}`);
			}
		};
		const fetchWithTracking = await OpenAICallTracker.getFetchFn(safeTrackerCallback, {
			bucketId,
			originalFetch: openaiCache.getFetchFn(),
		});

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Init OpenAI client
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		let openaiClient: OpenAI
		if (provider === UtilsAi.PROVIDER.OPENAI) {
			const baseURL = process.env.OPENAI_BASE_URL;
			openaiClient = new OpenAI({
				...(baseURL !== undefined && baseURL !== '' ? { baseURL } : {}),
				fetch: fetchWithTracking, // use the fetch function with tracking capabilities
			})
		} else if (provider === UtilsAi.PROVIDER.LMSTUDIO) {
			const baseURL = process.env.LMSTUDIO_BASE_URL ?? 'http://localhost:1234/v1';
			openaiClient = new OpenAI({
				baseURL,
				fetch: fetchWithTracking, // use the fetch function with tracking capabilities
			});
		} else {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		return openaiClient;
	}
}


