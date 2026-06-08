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

export type UtilsAiProvider = 'openai' | 'lmstudio' | 'ollama';

export type ProviderModelSpec = {
	provider: UtilsAiProvider;
	modelName: string;
};

export class UtilsAi {
	static PROVIDER = {
		OPENAI: 'openai' as UtilsAiProvider,
		LMSTUDIO: 'lmstudio' as UtilsAiProvider,
		OLLAMA: 'ollama' as UtilsAiProvider,
	}

	static SUPPORTED_PROVIDERS: UtilsAiProvider[] = ['openai', 'lmstudio', 'ollama'];

	// Bound the local-server reachability probe (lmstudio, ollama) so a dead
	// server fails the preflight fast instead of hanging the CLI. Mirrors the
	// probe timeout the web client's ModelsDiscovery uses.
	static PROVIDER_PROBE_TIMEOUT_MS = 1500;

	// Per-provider client wiring: the env var that overrides the base URL, the local
	// default base URL (omitted for openai, which falls back to the OpenAI SDK default),
	// and an optional placeholder apiKey for key-free local providers. The OpenAI SDK
	// constructor throws when no key is resolved, so ollama ships a dummy key whose value
	// Ollama ignores; openai and lmstudio pass no apiKey and keep reading OPENAI_API_KEY.
	static PROVIDER_CLIENT_CONFIGS: Record<UtilsAiProvider, { envVar: string; defaultBaseUrl?: string; apiKey?: string }> = {
		openai: { envVar: 'OPENAI_BASE_URL' },
		lmstudio: { envVar: 'LMSTUDIO_BASE_URL', defaultBaseUrl: 'http://localhost:1234/v1' },
		ollama: { envVar: 'OLLAMA_BASE_URL', defaultBaseUrl: 'http://localhost:11434/v1', apiKey: 'ollama' },
	};

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

	/**
	 * Preflight the SKILLET_MODEL_RUNNER override, when set, so a run fails fast
	 * with actionable guidance instead of dying inside the first model call (#265).
	 *
	 * Returns null when the variable is unset/empty or the selected provider is
	 * actually usable; otherwise a human-facing message explaining how to fix it:
	 *   - openai: OPENAI_API_KEY must be set.
	 *   - lmstudio / ollama: the local server must be reachable at its base URL.
	 */
	static async checkModelRunnerRunnable(): Promise<string | null> {
		const modelSpec = process.env.SKILLET_MODEL_RUNNER;
		if (modelSpec === undefined || modelSpec === '') {
			return null;
		}

		let provider: UtilsAiProvider;
		try {
			provider = UtilsAi.parseProviderModel(modelSpec).provider;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}

		return UtilsAi._checkProviderRunnable(provider, modelSpec);
	}

	/**
	 * Provider-specific runnability check behind checkModelRunnerRunnable. openai
	 * needs only OPENAI_API_KEY; the local providers (lmstudio, ollama) need their
	 * OpenAI-compatible server reachable at its base URL. Returns null when
	 * runnable, else a fix-oriented message naming the env var to set.
	 */
	private static async _checkProviderRunnable(provider: UtilsAiProvider, modelSpec: string): Promise<string | null> {
		const context = `SKILLET_MODEL_RUNNER='${modelSpec}' (provider: ${provider})`;

		if (provider === UtilsAi.PROVIDER.OPENAI) {
			const apiKey = process.env.OPENAI_API_KEY;
			if (apiKey === undefined || apiKey === '') {
				return [
					`${context} but OPENAI_API_KEY is not set.`,
					`Set it in your environment or a .env file, for example:`,
					`  export OPENAI_API_KEY=sk-...`,
				].join('\n');
			}
			return null;
		}

		// Local providers: confirm the server is running before the run starts.
		const clientConfig = UtilsAi.PROVIDER_CLIENT_CONFIGS[provider];
		const baseURL = process.env[clientConfig.envVar] ?? clientConfig.defaultBaseUrl ?? '';
		const reachable = await UtilsAi._isOpenAiCompatibleServerReachable(baseURL);
		if (reachable === true) {
			return null;
		}

		const startHint = provider === UtilsAi.PROVIDER.LMSTUDIO
			? `Start the LM Studio local server (Developer tab, then Start Server)`
			: `Start the Ollama server with 'ollama serve'`;
		return [
			`${context} but its server is not reachable at ${baseURL}.`,
			`${startHint}, or set ${clientConfig.envVar} to the server's base URL.`,
		].join('\n');
	}

	/**
	 * Liveness probe for an OpenAI-compatible server: GET <baseURL>/models,
	 * bounded by PROVIDER_PROBE_TIMEOUT_MS. Any HTTP response (even non-2xx) means
	 * the server is up; only a network error or timeout counts as not reachable.
	 * The response body is ignored — this checks the server is running, not which
	 * models it serves.
	 */
	private static async _isOpenAiCompatibleServerReachable(baseURL: string): Promise<boolean> {
		if (baseURL === '') {
			return false;
		}
		const url = `${baseURL.replace(/\/$/, '')}/models`;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), UtilsAi.PROVIDER_PROBE_TIMEOUT_MS);
		try {
			await fetch(url, { signal: controller.signal });
			return true;
		} catch {
			return false;
		} finally {
			clearTimeout(timeoutId);
		}
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

		const clientConfig = UtilsAi.PROVIDER_CLIENT_CONFIGS[provider];
		if (clientConfig === undefined) {
			throw new Error(`Unsupported provider: ${provider}`);
		}
		const baseURL = process.env[clientConfig.envVar] ?? clientConfig.defaultBaseUrl;
		const openaiClient = new OpenAI({
			...(baseURL !== undefined && baseURL !== '' ? { baseURL } : {}),
			...(clientConfig.apiKey !== undefined ? { apiKey: clientConfig.apiKey } : {}),
			fetch: fetchWithTracking, // use the fetch function with tracking capabilities
		});
		return openaiClient;
	}
}


