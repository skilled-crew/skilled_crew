import { z as Zod } from 'zod';

export const EvalDefinitionZod = Zod.object({
	id: Zod.number().int(),
	prompt: Zod.string().min(1),
	expected_output: Zod.string(),
	files: Zod.array(Zod.string()).default([]),
	assertions: Zod.array(Zod.string()).default([]),
});

export const EvalsConfigZod = Zod.object({
	name: Zod.string().min(1),
	evals: Zod.array(EvalDefinitionZod).min(1),
});

export const EvalGradeItemZod = Zod.object({
	score: Zod.number().min(0).max(10).describe('Score for the criterion, between 0 and 10'),
	reason: Zod.string().min(1),
});

export const EvalGradeResultZod = Zod.object({
	evalId: Zod.number().int(),
	expectedOutput: EvalGradeItemZod,
	assertions: Zod.array(EvalGradeItemZod),
});
