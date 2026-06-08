
export type McpServerConfigStdio = {
	name: string;
	type: 'stdio';
	command: string;
	args?: string[] | undefined;
	env?: Record<string, string> | undefined;
	cwd?: string | undefined;
};

export type McpServerConfigHttp = {
	name: string;
	type: 'http';
	url: string;
};

export type McpServerConfigSse = {
	name: string;
	type: 'sse';
	url: string;
};

export type McpServerConfig = McpServerConfigStdio | McpServerConfigHttp | McpServerConfigSse;
