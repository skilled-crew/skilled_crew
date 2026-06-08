import { z as Zod } from "zod";

export const SkillHeaderZod = Zod
	.strictObject({
		name: Zod
			.string()
			.min(1, "SKILL.md frontmatter 'name' cannot be empty")
			.max(64, "SKILL.md frontmatter 'name' must be <= 64 characters")
			.regex(
				/^[a-z0-9-_]+$/,
				"SKILL.md frontmatter 'name' must contain only lowercase letters, numbers, hyphens, and underscores"
			),
		description: Zod
			.string()
			.min(1, "SKILL.md frontmatter 'description' cannot be empty")
			.max(1024, "SKILL.md frontmatter 'description' must be <= 1024 characters"),
		license: Zod.string().optional(),
		compatibility: Zod.array(Zod.string()).optional(),
		metadata: Zod.record(Zod.string(), Zod.unknown()).optional(),
		"allowed-tools": Zod.string().optional(),
	})
