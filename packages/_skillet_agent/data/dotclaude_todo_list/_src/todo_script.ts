import fs from 'node:fs'
import path from 'node:path'
import { Command } from 'commander'
import ProperLockfile from 'proper-lockfile'

const TASKS_FILE = path.resolve(__dirname, '../_data/tasks.json')

interface Task {
	id: number
	description: string
	completed: boolean
}

async function withLock<T>(fn: () => T): Promise<T> {
	if (fs.existsSync(TASKS_FILE) === false) {
		fs.writeFileSync(TASKS_FILE, '[]')
	}
	const release = await ProperLockfile.lock(TASKS_FILE)
	try {
		return fn()
	} finally {
		await release()
	}
}

function loadTasks(): Task[] {
	if (fs.existsSync(TASKS_FILE) === false) {
		return []
	}
	return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'))
}

function saveTasks(tasks: Task[]): void {
	fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2))
}

// /////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////
//	Commands
// /////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////

async function createTask(description: string): Promise<void> {
	if (description === undefined || description === '') {
		console.error('Please provide a task description.')
		process.exit(1)
	}

	await withLock(() => {
		const tasks = loadTasks()
		const newId = Math.max(0, ...tasks.map(t => t.id)) + 1
		const newTask: Task = { id: newId, description, completed: false }
		tasks.push(newTask)
		saveTasks(tasks)
		console.log(`Task created: ${description}`)
	})
}

function listTasks(): void {
	const tasks = loadTasks()
	console.log(JSON.stringify(tasks))
}

async function completeTask(taskId: number): Promise<void> {
	if (Number.isNaN(taskId)) {
		console.error('Please provide a valid task ID number.')
		process.exit(1)
	}

	await withLock(() => {
		const tasks = loadTasks()
		const task = tasks.find(t => t.id === taskId)
		if (task === undefined) {
			console.error(`Task with ID ${taskId} not found.`)
			process.exit(1)
		}

		task.completed = true
		saveTasks(tasks)
		console.log(`Task completed: ${task.description}`)
	})
}

async function deleteTask(taskId: number): Promise<void> {
	if (Number.isNaN(taskId)) {
		console.error('Please provide a valid task ID.')
		process.exit(1)
	}

	await withLock(() => {
		const tasks = loadTasks()
		const task = tasks.find(t => t.id === taskId)
		if (task === undefined) {
			console.error(`Task with ID ${taskId} not found.`)
			process.exit(1)
		}

		const filtered = tasks.filter(t => t.id !== taskId)
		saveTasks(filtered)
		console.log(`Task deleted: ${task.description}`)
	})
}

// /////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////
//	CLI dispatch
// /////////////////////////////////////////////////////////////////////////////
// /////////////////////////////////////////////////////////////////////////////

async function main() {
	const program = new Command()

	program
		.name('todo_script')
		.description('Manage a todo list')

	program
		.command('create')
		.description('Create a new task')
		.argument('<description>', 'task description')
		.action(async (description: string) => {
			await createTask(description)
		})

	program
		.command('list')
		.description('List all tasks')
		.action(() => {
			listTasks()
		})

	program
		.command('complete')
		.description('Mark a task as completed')
		.argument('<id>', 'task ID')
		.action(async (id: string) => {
			await completeTask(parseInt(id))
		})

	program
		.command('delete')
		.description('Delete a task')
		.argument('<id>', 'task ID')
		.action(async (id: string) => {
			await deleteTask(parseInt(id))
		})

	await program.parseAsync()

}

void main()
