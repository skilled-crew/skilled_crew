import { z as Zod } from "zod";


export const AgentFrontmatterZod = Zod
	.strictObject({
		name: Zod
			.string()
			.min(1, "AGENTS.md frontmatter 'name' cannot be empty")
			.max(64, "AGENTS.md frontmatter 'name' must be <= 64 characters")
			.regex(
				/^[a-z0-9-_]+$/,
				"AGENTS.md frontmatter 'name' must contain only lowercase letters, numbers, hyphens, and underscores"
			),
		description: Zod
			.string()
			.min(1, "AGENTS.md frontmatter 'description' cannot be empty")
			.max(1024, "AGENTS.md frontmatter 'description' must be <= 1024 characters"),
		model: Zod
			.string()
			.nullable()
			.default(null)
	})