import BetterSqlite3 from "better-sqlite3";
import type OpenAiAgentsCore from "@openai/agents-core";


/**
 * SQLite-backed session store for conversation history. Suitable for production use with proper database management and backups.
 * Each session is identified by a combination of `userId` and `sessionName`, allowing for multiple sessions per user if needed.
 *
 * TODO - publish it as npm
 * TODO - make a json file version
 * TODO - make a session compression
 */
export class AiSessionStore {
	private _betterSqlite3: BetterSqlite3.Database;

	/**
	 * Initializes a new instance of the AiSessionStore class.
	 * @param dbFilePath The file path to the SQLite database.
	 */
	constructor(dbFilePath: string) {
		this._betterSqlite3 = new BetterSqlite3(dbFilePath);

		// Create the session_items table and index if they don't exist.
		// The table stores conversation items as JSON, indexed by user and session for fast lookups.
		this._betterSqlite3.exec(`
			CREATE TABLE IF NOT EXISTS session_items (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				session_name TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				item_json TEXT NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_session
			ON session_items (user_id, session_name, created_at);
		`);
	}

	async close(): Promise<void> {
		this._betterSqlite3.close();
	}

	/**
	 * Deletes all conversation items for a given user and session, effectively clearing the session history. This is a hard delete from the database.
	 * @param userId The ID of the user whose session should be deleted.
	 * @param sessionName The name of the session to delete.
	 */
	async deleteSession(userId: string, sessionName: string): Promise<void> {
		this._betterSqlite3.prepare(`
			DELETE FROM session_items
			WHERE user_id = ? AND session_name = ?
		`).run(userId, sessionName);
	}

	/**
	 * Retrieves a list of all session names for a given user. This allows clients to discover existing sessions for that user.
	 * @param userId The ID of the user whose session names should be retrieved.
	 * @returns An array of session names associated with the specified user.
	 */
	async getSessionNamesForUser(userId: string): Promise<string[]> {
		const rows = this._betterSqlite3.prepare(`
			SELECT session_name
			FROM session_items
			WHERE user_id = ?
			GROUP BY session_name
			ORDER BY MIN(created_at) DESC
		`).all(userId) as { session_name: string }[];

		const sessionNames: string[] = rows.map((row) => row.session_name);
		return sessionNames;
	}

	/**
	 * Returns an implementation of the OpenAiAgentsCore.Session interface for a specific user and session name.
	 * This allows the session to be used with the OpenAI Agents framework.
	 * @param userId The ID of the user for whom the session is being retrieved.
	 * @param sessionName The name of the session to retrieve.
	 * @returns An instance of OpenAiAgentsCore.Session for the specified user and session name.
	 */
	async getOpenAiSession(userId: string, sessionName: string): Promise<OpenAiAgentsCore.Session> {
		const openaiSession: OpenAiAgentsCore.Session = {
			getSessionId: async () => {
				return this._getSessionId(userId, sessionName);
			},
			getItems: async () => {
				return this._getItems(userId, sessionName);
			},
			addItems: async (agentInputItems: OpenAiAgentsCore.AgentInputItem[]) => {
				await this._addItems(userId, sessionName, agentInputItems);
			},
			popItem: async () => {
				return await this._popItem(userId, sessionName);
			},
			clearSession: async () => {
				await this._clearSession(userId, sessionName);
			}
		}
		return openaiSession;
	}

	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////
	// 	Private methods for managing the SQLite session. These are not exposed outside of this class, 
	// 	and are used to implement the OpenAiAgentsCore.Session interface.
	///////////////////////////////////////////////////////////////////////////////
	///////////////////////////////////////////////////////////////////////////////

	// Returns a unique session identifier combining user and session name.
	private async _getSessionId(userId: string, sessionName: string): Promise<string> {
		return `${userId}:${sessionName}`;
	}

	// Retrieves all conversation items for this session, ordered chronologically.
	private async _getItems(userId: string, sessionName: string): Promise<OpenAiAgentsCore.AgentInputItem[]> {
		const rows = this._betterSqlite3.prepare(`
				SELECT item_json
				FROM session_items
				WHERE user_id = ? AND session_name = ?
				ORDER BY created_at ASC, id ASC
			`)
			.all(userId, sessionName) as { item_json: string }[];

		return rows.map((r) => JSON.parse(r.item_json));
	}

	// Adds multiple conversation items to this session. Uses a transaction for atomicity.
	private async _addItems(userId: string, sessionName: string, agentInputItems: OpenAiAgentsCore.AgentInputItem[]): Promise<void> {
		const statement = this._betterSqlite3.prepare(`
			INSERT INTO session_items (user_id, session_name, created_at, item_json)
			VALUES (?, ?, ?, ?)
		`);

		const now = Date.now();

		// Wrap inserts in a transaction to ensure all items are added atomically.
		const insertMany = this._betterSqlite3.transaction((items: OpenAiAgentsCore.AgentInputItem[]) => {
			for (const item of items) {
				statement.run(userId, sessionName, now, JSON.stringify(item));
			}
		});

		insertMany(agentInputItems);
	}

	// Removes and returns the most recent conversation item from this session.
	private async _popItem(userId: string, sessionName: string): Promise<OpenAiAgentsCore.AgentInputItem | undefined> {
		const row = this._betterSqlite3.prepare(`
				SELECT id, item_json
				FROM session_items
				WHERE user_id = ? AND session_name = ?
				ORDER BY created_at DESC, id DESC
				LIMIT 1
			`)
			.get(userId, sessionName) as | { id: number; item_json: string } | undefined;

		if (row === undefined) return undefined;

		// Delete the row from the database after retrieving it.
		this._betterSqlite3
			.prepare(`DELETE FROM session_items WHERE id = ?`)
			.run(row.id);

		// Parse the JSON to return the conversation item.
		const agentInputItem: OpenAiAgentsCore.AgentInputItem = JSON.parse(row.item_json) as OpenAiAgentsCore.AgentInputItem;
		return agentInputItem
	}

	// Deletes all conversation items for this session.
	private async _clearSession(userId: string, sessionName: string): Promise<void> {
		this._betterSqlite3.prepare(`
				DELETE FROM session_items
				WHERE user_id = ? AND session_name = ?
			`)
			.run(userId, sessionName);
	}
}