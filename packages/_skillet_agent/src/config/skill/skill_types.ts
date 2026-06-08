export type SkillDocAllowedTool = {
	name: string;
	args?: string;
};

export interface SkillDocHeader {
	name: string;
	description: string;
	license?: string;
	compatibility?: string[];
	metadata?: Record<string, unknown>;
	allowedTools?: SkillDocAllowedTool[];
}

export interface SkillDoc {
	filePath: string;
	header: SkillDocHeader;
	body: string;
}
