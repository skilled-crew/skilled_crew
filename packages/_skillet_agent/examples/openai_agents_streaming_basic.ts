import Path from 'path';

import * as OpenAiAgents from '@openai/agents';
import { Cacheable } from 'cacheable';
import OpenAICache from 'openai-cache';
import KeyvSqlite from '@keyv/sqlite';
import { OpenAI } from 'openai';

async function* streamToAsyncGenerator(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
	for await (const chunk of stream) {
		yield chunk.toString();
	}
}

async function main() {

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	// initialize OpenAI client with caching
	const sqlitePath = `sqlite://${Path.resolve(__dirname, `./.openai_cache.sqlite`)}`;
	const sqliteCache = new Cacheable({ secondary: new KeyvSqlite(sqlitePath) });
	const openaiCache = new OpenAICache(sqliteCache);
	const openaiClient = new OpenAI({
		fetch: openaiCache.getFetchFn()
	});

	// set the global default OpenAI client used by @openai/agents
	OpenAiAgents.setDefaultOpenAIClient(openaiClient);

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	//	
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////


	const agent = new OpenAiAgents.Agent({
		model: 'gpt-4.1-nano',
		name: 'Storyteller',
		instructions:
			'You are a storyteller. You will be given a topic and you will tell a story about it.',
	});

	const result = await OpenAiAgents.run(agent, 'Tell me a story about a cat named prout.', {
		stream: true,
	});

	const textStream = result.toTextStream({
		compatibleWithNodeStreams: true,
	})

	for await (const chunk of streamToAsyncGenerator(textStream)) {
		process.stdout.write(chunk);
	}

	console.log('Stream completed');
	process.exit(0);
}


main().catch(console.error);