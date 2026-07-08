import { afterAll, beforeAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { vaultSession } from "@/modules/vault/vault.session";
import { encryptWithKey } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	settings,
	stores,
	user,
	workspaceMembers,
	workspaces,
	workspaceVault,
} from "@/utils/db/schema";

let app: import("@/index").App;

const TEST_USER_ID = "test-user-001";
const TEST_WORKSPACE_ID = "b0000000-0000-0000-0000-000000000001";

// Second user/workspace for isolation tests
const TEST_USER_ID_B = "test-user-002";
const TEST_WORKSPACE_ID_B = "b0000000-0000-0000-0000-000000000002";

beforeAll(async () => {
	// Ensure test user and workspace exist
	await db
		.insert(user)
		.values({
			email: "test@test.com",
			emailVerified: true,
			id: TEST_USER_ID,
			name: "Test User",
		})
		.onConflictDoNothing();

	await db
		.insert(workspaces)
		.values({
			id: TEST_WORKSPACE_ID,
			name: "Test Workspace",
		})
		.onConflictDoNothing();

	await db
		.insert(workspaceMembers)
		.values({
			role: "owner",
			userId: TEST_USER_ID,
			workspaceId: TEST_WORKSPACE_ID,
		})
		.onConflictDoNothing();

	// Second user/workspace for isolation tests
	await db
		.insert(user)
		.values({
			email: "other@test.com",
			emailVerified: true,
			id: TEST_USER_ID_B,
			name: "Other User",
		})
		.onConflictDoNothing();

	await db
		.insert(workspaces)
		.values({
			id: TEST_WORKSPACE_ID_B,
			name: "Other Workspace",
		})
		.onConflictDoNothing();

	await db
		.insert(workspaceMembers)
		.values({
			role: "owner",
			userId: TEST_USER_ID_B,
			workspaceId: TEST_WORKSPACE_ID_B,
		})
		.onConflictDoNothing();

	// Store credentials require a configured + unlocked workspace vault.
	// Give both test workspaces a deterministic vault and unlock it in-memory.
	await ensureTestVault(TEST_WORKSPACE_ID);
	await ensureTestVault(TEST_WORKSPACE_ID_B);

	const mod = await import("@/index");
	app = mod.default as unknown as import("@/index").App;
});

/** Deterministic 32-byte DEK — tests only. */
export const TEST_VAULT_DEK = Buffer.alloc(32, 7);

async function ensureTestVault(workspaceId: string) {
	await db
		.insert(workspaceVault)
		.values({
			kdfParams: {
				algo: "argon2id",
				iterations: 3,
				memoryKiB: 65536,
				parallelism: 1,
			},
			kdfSalt: Buffer.from("test-salt").toString("base64"),
			verifier: encryptWithKey(TEST_VAULT_DEK, "appboard-vault-v1"),
			workspaceId,
			wrapNonce: Buffer.from("test-nonce").toString("base64"),
			wrappedDek: Buffer.from("test-wrapped-dek").toString("base64"),
		})
		.onConflictDoNothing();
	vaultSession.unlock(workspaceId, TEST_VAULT_DEK);
}

afterAll(() => {
	app?.stop?.();
});

export function getBaseUrl() {
	return "http://localhost:3001";
}

export function getTestWorkspaceId() {
	return TEST_WORKSPACE_ID;
}

export function getTestUserIdB() {
	return TEST_USER_ID_B;
}

export function getTestWorkspaceIdB() {
	return TEST_WORKSPACE_ID_B;
}

/**
 * Create a Request with test auth header (X-Test-User-Id).
 * Only works in dev/test mode (NODE_ENV !== "production").
 */
export function authRequest(url: string, init?: RequestInit): Request {
	const headers = new Headers(init?.headers);
	headers.set("x-test-user-id", TEST_USER_ID);
	return new Request(url, { ...init, headers });
}

/**
 * Create a Request authenticated as the second test user (workspace B).
 */
export function authRequestB(url: string, init?: RequestInit): Request {
	const headers = new Headers(init?.headers);
	headers.set("x-test-user-id", TEST_USER_ID_B);
	return new Request(url, { ...init, headers });
}

export { authGuard } from "@/modules/auth";

/**
 * Cleanup helper: deletes only the stores created during a test suite.
 * Cascade deletes will remove all related apps, listings, assets, reviews, history.
 */
export async function cleanupStores(storeIds: string[]) {
	for (const id of storeIds) {
		await db.delete(stores).where(eq(stores.id, id));
	}
}

/**
 * Cleanup helper: deletes only the settings created during a test suite.
 * Scoped to test workspace A by default to prevent cross-workspace deletion.
 */
export async function cleanupSettings(
	keys: string[],
	workspaceId: string = TEST_WORKSPACE_ID,
) {
	for (const key of keys) {
		await db
			.delete(settings)
			.where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, key)));
	}
}
