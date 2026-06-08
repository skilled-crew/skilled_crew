// local imports
import { UserStore } from '../libs/user_store';
import type { UserRecord } from '../libs/user_store';

/**
 * Shared CLI helper for resolving a `--user-email` value to a user record.
 * Keeps the "verify the user exists, else exit" behaviour in one place so the
 * chat/run session userId and the jobs creator attribution stay consistent with
 * each other and with the web client (which resolves the same user record).
 */
export class CliUserHelper {
	/**
	 * Ensure the seeded default user exists in the shared store, creating it on
	 * first run so the default `--user-email` resolves out of the box (issue #261).
	 * Logs only when it actually creates the user, so repeat launches stay quiet.
	 */
	static async ensureDefaultUser(): Promise<void> {
		const userStore = new UserStore(UserStore.defaultDbPath());
		const alreadyPresent = userStore.findByEmail(UserStore.DEFAULT_USER_EMAIL) !== null;
		const userRecord = await userStore.ensureDefaultUser();
		userStore.close();
		if (alreadyPresent === false) {
			console.log(`Created default user "${userRecord.email}" in the user store (${UserStore.defaultDbPath()}).`);
		}
	}

	/**
	 * Resolve an email to its user record. Prints an actionable error and exits
	 * the process with code 1 when no such user exists in the store.
	 */
	static requireUserByEmail(userEmail: string): UserRecord {
		const userStore = new UserStore(UserStore.defaultDbPath());
		const userRecord = userStore.findByEmail(userEmail);
		userStore.close();
		if (userRecord === null) {
			console.error(`No user with email "${userEmail}" found in the user store (${UserStore.defaultDbPath()}). Seed it or pass an existing --user-email.`);
			process.exit(1);
		}
		return userRecord;
	}
}
