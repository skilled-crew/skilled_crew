---
name: create-task
description: Create a new task in the user's todo list.
---

# Create Task Skill

This skill adds a new task to the user's todo list. Each task is assigned a unique auto-incrementing ID and starts with an incomplete status.

The operation is executed via:

```
npx tsx ../../_src/todo_script.ts create <description>
```

## When to Use

Use this skill when the user wants to:

- Add a new item to their todo list
- Record something they need to do later

Do NOT use this skill to view, complete, or remove tasks — use the `list-tasks`, `complete-task`, or `delete-task` skills for those.

## Operation

### create — Add a new task

```
npx tsx ../../_src/todo_script.ts create <description>
```

**Arguments:**
- `<description>` — the task description text (required, wrap in quotes if it contains spaces)

**Output:**
```
Task created: Buy milk
```

**Error cases:**
- If no description is provided, the script exits with: `Please provide a task description.`

## Task Storage

Tasks are stored as a JSON array in `_data/tasks.json` (relative to the agent folder).

Each task has the following structure:
```json
{ "id": 1, "description": "Buy milk", "completed": false }
```

**Field details:**
- `id` — auto-incrementing positive integer, assigned sequentially
- `description` — text string of any length (no validation on content)
- `completed` — always `false` for newly created tasks

## Examples

**User:** "Add buy milk to my todo list"
```
npx tsx ../../_src/todo_script.ts create "Buy milk"
```

**User:** "I need to remember to call the dentist"
```
npx tsx ../../_src/todo_script.ts create "Call the dentist"
```

**User:** "Create a task to review the Q1 report"
```
npx tsx ../../_src/todo_script.ts create "Review the Q1 report"
```

## Notes

- Task IDs are auto-incrementing and start at 1 for the first task
- Tasks persist across sessions (stored in JSON file on disk)
- Duplicate task descriptions are allowed
