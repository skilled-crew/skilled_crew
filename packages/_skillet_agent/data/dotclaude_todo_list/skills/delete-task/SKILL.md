---
name: delete-task
description: Delete a task from the user's todo list.
---

# Delete Task Skill

This skill permanently removes a task from the todo list by its ID. **This action cannot be undone.** Unlike completing a task (which marks it done), deletion removes the task entirely. Use the `list-tasks` skill first if you need to look up the task ID.

The operation is executed via:

```
npx tsx ../../_src/todo_script.ts delete <id>
```

---

## When to Use

Use this skill when the user wants to:

- Remove a task they no longer need
- Clean up tasks that are no longer relevant
- Delete a task that was added by mistake

Do NOT use this skill to mark a task as done — use the `complete-task` skill for that. Do NOT use this skill to view or create tasks — use `list-tasks` or `create-task`.

---

## Operation

### delete — Remove a task permanently

```
npx tsx ../../_src/todo_script.ts delete <id>
```

**Arguments:**
- `<id>` — the numeric ID of the task to delete (required)

**Output:**
```
Task deleted: Buy milk
```

**Error cases:**
- If no ID is provided or the ID is not a number: `Please provide a valid task ID.`
- If no task with that ID exists: `Task with ID <id> not found.`

---

## Task Storage

Tasks are stored in:
```
todo_list/_data/tasks.json
```

When you delete a task, it removes the task object from the JSON array entirely. The IDs of remaining tasks are not reassigned.

---

## Examples

**User:** "Delete task 2"
```
npx tsx ../../_src/todo_script.ts delete 2
```

**User:** "Remove the milk task" (after listing tasks to find ID 1)
```
npx tsx ../../_src/todo_script.ts delete 1
```

**User:** "I don't need to do task 5 anymore"
```
npx tsx ../../_src/todo_script.ts delete 5
```
