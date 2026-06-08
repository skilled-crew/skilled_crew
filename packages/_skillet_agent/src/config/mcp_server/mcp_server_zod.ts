import { z as Zod } from 'zod';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Zod schema
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export const McpServerConfigZod = Zod.discriminatedUnion('type', [
	Zod.strictObject({
		name: Zod.string().min(1),
		type: Zod.literal('stdio'),
		command: Zod.string().min(1),
		args: Zod.array(Zod.string()).optional(),
		env: Zod.record(Zod.string(), Zod.string()).optional(),
		cwd: Zod.string().optional(),
	}),
	Zod.strictObject({
		name: Zod.string().min(1),
		type: Zod.literal('http'),
		url: Zod.string(),
	}),
	Zod.strictObject({
		name: Zod.string().min(1),
		type: Zod.literal('sse'),
		url: Zod.string(),
	}),
]);
