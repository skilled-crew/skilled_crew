import { AgentRunnerStepResult, AgentRunnerFinalResult } from '../agent_runner/agent_runner_types';

export type EvalDefinition = {
	id: number;
	prompt: string;
	expected_output: string;
	files: string[];
	assertions: string[];
};

export type EvalsConfig = {
	name: string;
	evals: EvalDefinition[];
};

export type EvalResponseLog = {
	stepResults: AgentRunnerStepResult[];
	finalResult: AgentRunnerFinalResult;
};

export type EvalRunResult = {
	evalId: number;
	responseLog: EvalResponseLog;
	responseDelayMs: number;
	responseCharCount: number;
};

export type EvalGradeItem = {
	score: number;
	reason: string;
};

export type EvalGradeResult = {
	evalId: number;
	expectedOutput: EvalGradeItem;
	assertions: EvalGradeItem[];
};
