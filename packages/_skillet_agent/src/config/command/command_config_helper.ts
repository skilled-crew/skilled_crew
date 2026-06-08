// node imports
import Fs from 'node:fs';
import Path from 'node:path';

// npm imports
import matter from 'gray-matter';
import Chalk from 'chalk';

// local imports
import { CommandDoc, CommandFrontmatter } from './command_types';
import { CommandFrontmatterZod } from './command_zod';
import { SkilledCrewYamlConfigCommand } from '../skilled_crew_yaml/skilled_crew_yaml_types';


export class CommandConfigHelper {
	static COMMAND_EXTENSION = '.command.md';

	/**
	 * Scans the provided command file paths and returns a map of command name → CommandDoc.
	 * Returns an empty Map if no valid files are found.
	 * Invalid files are skipped with a warning.
	 */
	static async loadConfig(skilledCrewYamlConfigCommands: SkilledCrewYamlConfigCommand[], {
		verbose = false
	}: {
		verbose?: boolean
	} = {}): Promise<CommandDoc[]> {
		// read and parse each command file, skipping invalid files with a warning
		const commandDocs: CommandDoc[] = [];
		for (const skilledCrewYamlConfigCommand of skilledCrewYamlConfigCommands) {
			const filePath = skilledCrewYamlConfigCommand.filePath;
			try {
				// read the file content
				const fileContent = await Fs.promises.readFile(filePath, 'utf8');

				// parse the frontmatter
				const fontMatterParsed = matter(fileContent);
				const header: CommandFrontmatter = CommandFrontmatterZod.parse(fontMatterParsed.data as Record<string, unknown>);

				// create the CommandDoc and add it to the map
				const commandDoc: CommandDoc = {
					filePath,
					commandName: skilledCrewYamlConfigCommand.name,
					header: header,
					content: fontMatterParsed.content.trim()
				};
				commandDocs.push(commandDoc);

				// log the loaded command
				if (verbose) {
					console.log(`[${Chalk.magenta('command')}] Loaded ${Chalk.green('/' + skilledCrewYamlConfigCommand.name)} described as : ${Chalk.gray(header.description)}`);
				}
			} catch (err) {
				console.warn(`[${Chalk.magenta('command')}] Skipping ${filePath}: ${(err as Error).message}`);
			}
		}

		// Return the array of CommandDoc
		return commandDocs;
	}
}
