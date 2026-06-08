// node imports
import Fs from 'node:fs';
import Path from 'node:path';

// npm imports
import YAML from 'yaml';

// local imports
import { SkilledCrewYamlConfigZod } from './skilled_crew_yaml_zod';
import { SkilledCrewYamlConfig } from './skilled_crew_yaml_types';

export class SkilledCrewYamlConfigHelper {
	static async loadConfig(skilledCrewYamlConfigPath: string): Promise<SkilledCrewYamlConfig> {
		// read the file
		const skilledCrewYamlContent = await Fs.promises.readFile(skilledCrewYamlConfigPath, 'utf8');
		// parse and validate the yaml with zod
		const skilledCrewYamlConfig = SkilledCrewYamlConfigZod.parse(YAML.parse(skilledCrewYamlContent));

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Make relative paths absolute
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// all page of skilledCrewYamlConfig are relative to the skilled_crew_yaml file, so we need to resolve them to absolute paths
		const skilledCrewYamlDir = Path.dirname(skilledCrewYamlConfigPath);

		// resolve command file paths
		for (const commandConfig of skilledCrewYamlConfig.commands) {
			commandConfig.filePath = Path.resolve(skilledCrewYamlDir, commandConfig.filePath);
		}

		// resolve script_runtime dockerfile path (if set)
		if (skilledCrewYamlConfig.script_runtime.dockerfile !== null) {
			skilledCrewYamlConfig.script_runtime.dockerfile = Path.resolve(skilledCrewYamlDir, skilledCrewYamlConfig.script_runtime.dockerfile);
		}


		// resolve agent related paths
		for (const agentName in skilledCrewYamlConfig.agents) {
			const agentConfig = skilledCrewYamlConfig.agents[agentName];
			// resolve instructions path
			if (agentConfig.instructionsPath !== null) {
				agentConfig.instructionsPath = Path.resolve(skilledCrewYamlDir, agentConfig.instructionsPath);
			}
			// resolve code-worker path
			if (agentConfig.codeWorkerPath !== null) {
				agentConfig.codeWorkerPath = Path.resolve(skilledCrewYamlDir, agentConfig.codeWorkerPath);
			}
			// resolve mcp server file paths
			for (const mcpServerConfig of agentConfig.mcp_servers) {
				mcpServerConfig.filePath = Path.resolve(skilledCrewYamlDir, mcpServerConfig.filePath);
			}
			// resolve skill folder paths
			for (const skillConfig of agentConfig.skills) {
				skillConfig.folderPath = Path.resolve(skilledCrewYamlDir, skillConfig.folderPath);
			}
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	return the config
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// return the config
		return skilledCrewYamlConfig;
	}
}