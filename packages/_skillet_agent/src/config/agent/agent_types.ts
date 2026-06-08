// local imports
import type { SkillDoc } from "../skill/skill_types";

export interface AgentDocHeader {
	name: string;
	description: string;
	model: string | null;
}

export interface AgentsDoc {
	filePath: string;
	header: AgentDocHeader;
	body: string;
}

export interface AgentConfig {
	// agentFolder: string;
	agents: AgentsDoc | null;
	skillDocs: SkillDoc[];
}
