export type CommandFrontmatter = {
	description: string;
	agent?: string | undefined;
	lane?: 'chat' | 'job' | undefined;
	template?: string | undefined;
	inputs?: Record<string, string> | undefined;
}

export type CommandDoc = {
	filePath: string;
	commandName: string;
	header: CommandFrontmatter;
	content: string;
}
