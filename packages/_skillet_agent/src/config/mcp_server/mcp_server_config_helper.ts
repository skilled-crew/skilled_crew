// node imports
import Fs from 'node:fs';
import Path from 'node:path';

// local imports
import { McpServerConfig } from './mcp_server_types'
import { McpServerConfigZod } from './mcp_server_zod';
import { SkilledCrewYamlConfigMcpServer } from '../skilled_crew_yaml/skilled_crew_yaml_types';

export class McpServerConfigHelper {

	/**
	 * Scans the provided MCP server config paths and returns validated MCP server configs.
	 * Returns an empty array if no valid configs are found.
	 */
	static async loadConfig(skilledCrewYamlConfigMcpServers: SkilledCrewYamlConfigMcpServer[]): Promise<McpServerConfig[]> {
		const mcpServerConfigs: McpServerConfig[] = [];
		for (const skilledCrewYamlConfigMcpServer of skilledCrewYamlConfigMcpServers) {
			// Read the MCP server config file
			const fileContent = await Fs.promises.readFile(skilledCrewYamlConfigMcpServer.filePath, 'utf8');
			// Parse JSON and validate against schema
			const mcpServerConfig: McpServerConfig = McpServerConfigZod.parse(JSON.parse(fileContent));
			// Collect validated config
			mcpServerConfigs.push(mcpServerConfig);
		}

		return mcpServerConfigs;
	}
}
