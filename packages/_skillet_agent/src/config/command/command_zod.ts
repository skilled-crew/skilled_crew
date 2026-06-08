import { z as Zod } from 'zod';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//	Zod schema
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export const CommandFrontmatterZod = Zod.object({
	description: Zod.string().min(1, "Command 'description' cannot be empty"),
	agent: Zod.string().optional(),
	// `lane: 'job'` makes this command post a template-instantiated job graph
	// to the job board instead of running the agent in-process. `template` is
	// required when lane is 'job'. `inputs` maps template input names to value
	// expressions; `$ARGUMENTS` is substituted with the chat-typed argument
	// text before lookup. Default lane is 'chat' (today's behaviour).
	lane: Zod.enum(['chat', 'job']).optional(),
	template: Zod.string().optional(),
	inputs: Zod.record(Zod.string(), Zod.string()).optional(),
});
