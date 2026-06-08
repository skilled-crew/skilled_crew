// node imports
import Fs from "node:fs";

// npm imports
import grayMatter from "gray-matter";

// local imports
import { AgentsDoc, AgentConfig } from "./agent_types";
import { AgentFrontmatterZod } from "./agent_zod";
import { SkillConfigHelper } from "../skill/skill_config_helper";
import { SkillDoc } from "../skill/skill_types";
import { SkilledCrewYamlConfigAgent } from "../skilled_crew_yaml/skilled_crew_yaml_types";

export class AgentConfigHelper {
	static async loadConfig(skilledCrewYamlConfigAgent: SkilledCrewYamlConfigAgent): Promise<AgentConfig> {

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	AGENTS.md 
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// Load AGENTS.md if it exists
		let agentsDoc: AgentsDoc | null = null;
		if (skilledCrewYamlConfigAgent.instructionsPath !== null) {
			const fileContent = await Fs.promises.readFile(skilledCrewYamlConfigAgent.instructionsPath, "utf8");

			// parse the frontmatter
			const contentParsed = grayMatter(fileContent);

			agentsDoc = {
				filePath: skilledCrewYamlConfigAgent.instructionsPath,
				header: AgentFrontmatterZod.parse(contentParsed.data),
				body: contentParsed.content,
			};
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Load all SKILL.md files under {agentFolderPath}/skills/**/SKILL.md
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// Load all skill docs
		const skillDocs: SkillDoc[] = [];
		for (const skilledCrewYamlConfigSkill of skilledCrewYamlConfigAgent.skills) {
			const skillDoc = await SkillConfigHelper.loadSkillDoc(skilledCrewYamlConfigSkill.folderPath);
			skillDocs.push(skillDoc);
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Sanity check - if that needed ?
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		// clean up skill names
		for (const skillDoc of skillDocs) {
			skillDoc.header.name = skillDoc.header.name.trim();
			skillDoc.header.description = skillDoc.header.description.trim();
		}

		// ensure skill names are unique
		const seenSkillNames = new Set<string>();
		for (const skillDoc of skillDocs) {
			if (seenSkillNames.has(skillDoc.header.name)) {
				throw new Error(`Duplicate SKILL name '${skillDoc.header.name}' found in ${skillDoc.filePath}`);
			}
			seenSkillNames.add(skillDoc.header.name);
		}

		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////
		//	Return the result
		///////////////////////////////////////////////////////////////////////////////
		///////////////////////////////////////////////////////////////////////////////

		const agentConfig: AgentConfig = {
			agents: agentsDoc,
			skillDocs: skillDocs,
		};
		return agentConfig;
	}
}
