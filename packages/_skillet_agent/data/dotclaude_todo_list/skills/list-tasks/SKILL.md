---
name: list-tasks
description: Display all tasks with their completion status.
---

# List Tasks Skill

This skill retrieves and displays all tasks in the user's todo list, including their IDs, descriptions, and completion status. This is a read-only operation — no tasks are modified.

The operation is executed via (from the skill directory):

```
npx tsx ../../_src/todo_script.ts list
```

---

## When to Use

Use this skill when the user wants to:

- See all their current tasks
- Check what tasks are pending or completed
- Look up a task ID before completing or deleting it

Do NOT use this skill to create, complete, or delete tasks — use the `create-task`, `complete-task`, or `delete-task` skills for those.

---

## Operation

### list — Display all tasks

```sh
npx tsx ../../_src/todo_script.ts list
```

**Arguments:** None.

**Output:** A JSON array of all tasks.

**Output example:**
```json
[
  {
    "id": 1,
    "description": "Buy milk",
    "completed": false
  },
  {
    "id": 2,
    "description": "Call the dentist",
    "completed": true
  }
]
```

**When no tasks exist:** Returns an empty array `[]`.

---

## Task Data Format

Tasks are read from `todo_list/_data/tasks.json`:

Each task has the following structure:
```json
{ "id": 1, "description": "Buy milk", "completed": false }
```

- `id` — unique numeric identifier
- `description` — task text
- `completed` — `false` for pending, `true` for done

---

## Examples

**User:** "What are my tasks?"
```sh
npx tsx ../../_src/todo_script.ts list
```

**User:** "Show me my todo list"
```sh
npx tsx ../../_src/todo_script.ts list
```

**User:** "Do I have anything left to do?"
```sh
npx tsx ../../_src/todo_script.ts list
```
