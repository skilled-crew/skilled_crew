---
name: complete-task
description: Mark a task as completed.
---

# Complete Task Skill

This skill marks an existing task as completed by its ID. The task remains in the list with a completed status. Use the `list-tasks` skill first if you need to look up the task ID.

The operation is executed via:

```
npx tsx ../../_src/todo_script.ts complete <id>
```

---

## When to Use

Use this skill when the user wants to:

- Mark a task as done
- Check off a task from their todo list

Do NOT use this skill to create, list, or delete tasks — use the `create-task`, `list-tasks`, or `delete-task` skills for those. If the user wants to remove a task entirely rather than mark it done, use `delete-task`.

---

## Operation

### complete — Mark a task as done

```
npx tsx ../../_src/todo_script.ts complete <id>
```

**Arguments:**
- `<id>` — the numeric ID of the task to complete (required)

**Output:**
```
Task completed: Buy milk
```

**Error cases:**
- If no ID is provided or the ID is not a number: `Please provide a valid task ID number.`
- If no task with that ID exists: `Task with ID <id> not found.`

---

## Task Storage

Tasks are stored in:
```
_data/tasks.json
```

Completing a task sets its `completed` field from `false` to `true`:
```json
{ "id": 1, "description": "Buy milk", "completed": true }
```

---

## Examples

**User:** "I finished task 3"
```
npx tsx ../../_src/todo_script.ts complete 3
```

**User:** "Mark 'Buy milk' as done" (after listing tasks to find ID 1)
```
npx tsx ../../_src/todo_script.ts complete 1
```

**User:** "I've done the first task on my list" (list first, then complete)
```
npx tsx ../../_src/todo_script.ts list
npx tsx ../../_src/todo_script.ts complete <id-from-list>
```
