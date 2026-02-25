import { afterAll, beforeAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import {
	settings,
	stores,
	user,
	workspaceMembers,
	workspaces,
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

	const mod = await import("@/index");
	app = mod.default as unknown as import("@/index").App;
});

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
			.where(
				and(eq(settings.workspaceId, workspaceId), eq(settings.key, key)),
			);
	}
}
