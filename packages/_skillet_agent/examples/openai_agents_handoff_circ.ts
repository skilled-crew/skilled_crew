import { Agent, handoff, run, tool } from "@openai/agents";
import { RECOMMENDED_PROMPT_PREFIX } from '@openai/agents-core/extensions';
import { z } from "zod";

// ── Shared state ────────────────────────────────────────────────────────────

interface Task {
	id: string;
	title: string;
	completed: boolean;
}

const tasks: Task[] = [];

const nextId = (() => {
	let seq = 0;
	return () => String(++seq);
})();

// ── Tools ───────────────────────────────────────────────────────────────────

const addTaskTool = tool({
	name: "add_task",
	description: "Add a new task to the todo list",
	parameters: z.object({ title: z.string().describe("Task title") }),
	execute: async ({ title }) => {
		const task: Task = { id: nextId(), title, completed: false };
		tasks.push(task);
		return `Added task #${task.id}: "${task.title}"`;
	},
});

const removeTaskTool = tool({
	name: "remove_task",
	description: "Remove a task from the todo list by its id",
	parameters: z.object({ id: z.string().describe("Task id to remove") }),
	execute: async ({ id }) => {
		const idx = tasks.findIndex((t) => t.id === id);
		if (idx === -1) return `Task #${id} not found.`;
		const [removed] = tasks.splice(idx, 1);
		return `Removed task #${removed.id}: "${removed.title}"`;
	},
});

const listTasksTool = tool({
	name: "list_tasks",
	description: "List all tasks in the todo list",
	parameters: z.object({}),
	execute: async () => {
		if (tasks.length === 0) return "The todo list is empty.";
		return tasks
			.map((t) => `#${t.id} [${t.completed ? "x" : " "}] ${t.title}`)
			.join("\n");
	},
});

const completeTaskTool = tool({
	name: "complete_task",
	description: "Mark a task as completed by its id",
	parameters: z.object({ id: z.string().describe("Task id to complete") }),
	execute: async ({ id }) => {
		const task = tasks.find((t) => t.id === id);
		if (!task) return `Task #${id} not found.`;
		task.completed = true;
		return `Completed task #${task.id}: "${task.title}"`;
	},
});

// ── Agents ──────────────────────────────────────────────────────────────────

const orchestrator = new Agent({
	name: "Orchestrator",
	instructions:
		"You coordinate todo-list operations. " +
		"Determine the user's intent and hand off to the appropriate specialist agent. " +
		"Never perform task operations yourself — always delegate.",
});

const adder = new Agent({
	name: "AddTaskAgent",
	handoffDescription: "Hand off here when the user wants to add or create tasks.",
	instructions:
		"You are responsible for adding tasks to the todo list. " +
		"Use the add_task tool, then confirm the result to the user. " +
		"If the user changes intent, hand off to the appropriate agent.",
	tools: [addTaskTool],
});

const remover = new Agent({
	name: "RemoveTaskAgent",
	handoffDescription: "Hand off here when the user wants to remove or delete tasks.",
	instructions:
		"You are responsible for removing tasks from the todo list. " +
		"Use the remove_task tool, then confirm the result to the user. " +
		"If the user changes intent, hand off to the appropriate agent.",
	tools: [removeTaskTool],
});

const lister = new Agent({
	name: "ListTasksAgent",
	handoffDescription: "Hand off here when the user wants to see or list tasks.",
	instructions:
		"You are responsible for listing tasks in the todo list. " +
		"Use the list_tasks tool, then present the results to the user. " +
		"If the user changes intent, hand off to the appropriate agent.",
	tools: [listTasksTool],
});

const completer = new Agent({
	name: "CompleteTaskAgent",
	handoffDescription: "Hand off here when the user wants to mark tasks as done.",
	instructions:
		"You are responsible for marking tasks as completed. " +
		"Use the complete_task tool, then confirm the result to the user. " +
		"If the user changes intent, hand off to the appropriate agent.",
	tools: [completeTaskTool],
});

// ── Wire up full-mesh handoffs (every agent → every other agent) ────────────

const agents = [orchestrator, adder, remover, lister, completer];

for (const agent of agents) {
	agent.handoffs = agents
		.filter((other) => other !== agent)
		.map((target) => handoff(target));
}

// ── Public API ──────────────────────────────────────────────────────────────

export { orchestrator, adder, remover, lister, completer, agents, run };