export type SkilledCrewYamlConfigCommand = {
	name: string;
	filePath: string;
}

export type SkilledCrewYamlConfigMcpServer = {
	filePath: string;
}

export type SkilledCrewYamlConfigSkill = {
	name: string;
	folderPath: string;
}

export type SkilledCrewYamlConfigAgent = {
	instructionsPath: string | null;
	codeWorkerPath: string | null;
	mcp_servers: SkilledCrewYamlConfigMcpServer[];
	skills: SkilledCrewYamlConfigSkill[];
}

export type SkilledCrewYamlConfigScriptRuntime = {
	kind: 'local' | 'container';
	dockerfile: string | null;
}

export type SkilledCrewYamlConfig = {
	version: string;
	id: string;
	commands: SkilledCrewYamlConfigCommand[];
	entryPointAgent: string | null;
	agents: {
		[name: string]: SkilledCrewYamlConfigAgent;
	};
	script_runtime: SkilledCrewYamlConfigScriptRuntime;
}