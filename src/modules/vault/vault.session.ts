/**
 * In-memory store of unlocked Data Encryption Keys (DEK), keyed by user id.
 *
 * The DEK lives ONLY here — never on disk, never in logs. It is placed here when
 * a user unlocks their vault during an active session and is dropped on lock,
 * on TTL expiry, or on process restart. A stolen database therefore cannot
 * decrypt credentials; only a live, unlocked session holds the key in RAM.
 *
 * Note: this is per-process. In a multi-instance deployment each instance
 * requires its own unlock (sticky sessions or per-instance unlock).
 */
const UNLOCK_TTL_MS = 30 * 60 * 1000; // 30 min, refreshed on each access

interface VaultEntry {
	dek: Buffer;
	expiresAt: number;
}

const unlocked = new Map<string, VaultEntry>();

export const vaultSession = {
	getDek(workspaceId: string): Buffer | undefined {
		const entry = unlocked.get(workspaceId);
		if (!entry) return undefined;
		if (entry.expiresAt < Date.now()) {
			entry.dek.fill(0);
			unlocked.delete(workspaceId);
			return undefined;
		}
		entry.expiresAt = Date.now() + UNLOCK_TTL_MS; // sliding expiry
		return entry.dek;
	},

	isUnlocked(workspaceId: string): boolean {
		return this.getDek(workspaceId) !== undefined;
	},

	lock(workspaceId: string): void {
		const entry = unlocked.get(workspaceId);
		if (entry) {
			entry.dek.fill(0); // best-effort zeroing of key material
			unlocked.delete(workspaceId);
		}
	},
	unlock(
		workspaceId: string,
		dek: Buffer,
		ttlMs: number = UNLOCK_TTL_MS,
	): void {
		const previous = unlocked.get(workspaceId);
		if (previous) previous.dek.fill(0);
		unlocked.set(workspaceId, { dek, expiresAt: Date.now() + ttlMs });
	},
};
