// node imports
import Fs from "node:fs";
import Path from "node:path";

// npm imports
import grayMatter from "gray-matter";

// local imports
import { SkillHeaderZod } from "./skill_zod";
import { SkillDocAllowedTool, SkillDoc } from "./skill_types";

export class SkillConfigHelper {
	static SKILL_FILE_NAME = "SKILL.md";

	/**
	 * 
	 * @param input 
	 * @returns 
	 */
	static async parseAllowedTools(input: string): Promise<SkillDocAllowedTool[]> {
		const result: SkillDocAllowedTool[] = [];

		// Match tokens like: Bash(python:*), Read, Write
		const regex = /([A-Za-z]+)(\(([^)]*)\))?/g;

		let match: RegExpExecArray | null;
		while ((match = regex.exec(input)) !== null) {
			const [, name, , args] = match;

			result.push({
				name,
				...(args ? { args } : {}),
			});
		}

		return result;
	}

	/**
	 * 
	 * @param skillFolder 
	 * @returns 
	 */
	static async loadSkillDoc(skillFolder: string): Promise<SkillDoc> {
		const filePath = Path.join(skillFolder, SkillConfigHelper.SKILL_FILE_NAME);
		const fileContent = await Fs.promises.readFile(filePath, "utf8");

		// parse the frontmatter
		const contentMatter = grayMatter(fileContent);

		// parse frontmatter and map to SkillDocHeader
		const headerParsed = SkillHeaderZod.parse(contentMatter.data);

		// build the header object with required fields
		const header: SkillDoc["header"] = {
			name: headerParsed.name,
			description: headerParsed.description,
		}

		// add optional license if present
		if (headerParsed.license !== undefined) {
			header.license = headerParsed.license;
		}

		// add optional compatibility if present
		if (headerParsed.compatibility !== undefined) {
			header.compatibility = headerParsed.compatibility;
		}

		// add optional metadata if present
		if (headerParsed.metadata !== undefined) {
			header.metadata = headerParsed.metadata;
		}

		// parse and add allowed tools if present 
		// example of allowed-tools string: "Bash(python:*) Read Write"
		if (headerParsed["allowed-tools"] !== undefined) {
			// parse allowed tools string into array
			const toolsString = headerParsed["allowed-tools"];
			const allowedTools = await SkillConfigHelper.parseAllowedTools(toolsString);
			// sanity check - the allowed tools
			for (const allowedTool of allowedTools) {
				if (allowedTool.name === 'Bash') {
					// for bash, check the args is in the format of "command:pattern", e.g. "python:*"
					if (!allowedTool.args) {
						throw new Error(`Allowed tool "Bash" must have args in the format of "command:pattern", e.g. "python:*"`);
					}
					const [command, pattern] = allowedTool.args.split(':');
					if (!command || !pattern) {
						throw new Error(`Allowed tool "Bash" must have args in the format of "command:pattern", e.g. "python:*"`);
					}
				}
			}
			// add to header
			header.allowedTools = allowedTools;
		}

		// construct the skillDoc
		const skillDoc: SkillDoc = {
			filePath,
			header,
			body: contentMatter.content,
		};

		// return skillDoc
		return skillDoc;
	}
}
