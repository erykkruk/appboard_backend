import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { apiKeysController } from "@/modules/auth/api-keys.controller";
import {
	authGuard,
	authRequest,
	authRequestB,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import { apiKeys, stores } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

const app = new Elysia()
	.use(authGuard)
	.use(errorHandler)
	.group("/api", (a) => a.use(apiKeysController).use(appsController));

const KEY_NAME = "MCP server";
const storeIds: string[] = [];

/** Issue a request carrying only an `Authorization: Bearer <token>` header. */
function bearerRequest(path: string, token: string): Request {
	return new Request(`http://localhost${path}`, {
		headers: { authorization: `Bearer ${token}` },
	});
}

async function createKey(req: typeof authRequest, name = KEY_NAME) {
	const res = await app.handle(
		req("http://localhost/api/auth/api-keys", {
			body: JSON.stringify({ name }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}),
	);
	return { data: await res.json(), status: res.status };
}

beforeAll(async () => {
	// Seed an app in workspace A and one in workspace B for isolation checks.
	const storeA = await seedTestStore(getTestWorkspaceId());
	const storeB = await seedTestStore(getTestWorkspaceIdB());
	storeIds.push(storeA.id, storeB.id);
	await seedTestApp(storeA.id);
	await seedTestApp(storeB.id);
});

afterAll(async () => {
	for (const id of storeIds) {
		await db.delete(stores).where(eq(stores.id, id));
	}
	await db.delete(apiKeys).where(eq(apiKeys.workspaceId, getTestWorkspaceId()));
	await db
		.delete(apiKeys)
		.where(eq(apiKeys.workspaceId, getTestWorkspaceIdB()));
});

describe("API key management", () => {
	it("create returns the plaintext token exactly once", async () => {
		const { data, status } = await createKey(authRequest);
		expect(status).toBe(200);
		expect(data.token).toMatch(/^ab_/);
		expect(data.prefix).toBe(data.token.slice(0, 10));
		expect(data.name).toBe(KEY_NAME);
		expect(data.id).toBeString();
	});

	it("list returns prefix but never the token or hash", async () => {
		await createKey(authRequest, "List probe");
		const res = await app.handle(
			authRequest("http://localhost/api/auth/api-keys"),
		);
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(Array.isArray(data)).toBe(true);
		expect(data.length).toBeGreaterThan(0);
		for (const key of data) {
			expect(key.prefix).toMatch(/^ab_/);
			expect(key).not.toHaveProperty("token");
			expect(key).not.toHaveProperty("keyHash");
			expect(key).not.toHaveProperty("key_hash");
		}
	});

	it("revoke marks the key revoked", async () => {
		const { data: created } = await createKey(authRequest, "Revoke probe");
		const res = await app.handle(
			authRequest(`http://localhost/api/auth/api-keys/${created.id}`, {
				method: "DELETE",
			}),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).revoked).toBe(true);
	});
});

describe("API key authentication", () => {
	it("a bearer token reads workspace A's apps", async () => {
		const { data: created } = await createKey(authRequest, "Bearer read");
		const res = await app.handle(bearerRequest("/api/apps", created.token));
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(Array.isArray(data.apps)).toBe(true);
		expect(data.apps.length).toBeGreaterThan(0);
	});

	it("an invalid token is rejected with 401", async () => {
		const res = await app.handle(bearerRequest("/api/apps", "ab_not-a-key"));
		expect(res.status).toBe(401);
	});

	it("a revoked token is rejected with 401", async () => {
		const { data: created } = await createKey(authRequest, "Revoked auth");
		await app.handle(
			authRequest(`http://localhost/api/auth/api-keys/${created.id}`, {
				method: "DELETE",
			}),
		);
		const res = await app.handle(bearerRequest("/api/apps", created.token));
		expect(res.status).toBe(401);
	});
});

describe("API key isolation + management restrictions", () => {
	it("a workspace A key cannot read workspace B data", async () => {
		const { data: created } = await createKey(authRequest, "Isolation A");
		const res = await app.handle(bearerRequest("/api/apps", created.token));
		const data = await res.json();
		// All returned apps belong to workspace A's store, never workspace B's.
		const appIds = data.apps.map((a: { id: string }) => a.id);
		const bRes = await app.handle(authRequestB("http://localhost/api/apps"));
		const bData = await bRes.json();
		const bAppIds = bData.apps.map((a: { id: string }) => a.id);
		for (const id of appIds) {
			expect(bAppIds).not.toContain(id);
		}
		expect(appIds.length).toBeGreaterThan(0);
	});

	it("key management rejects bearer auth (requires a session)", async () => {
		const { data: created } = await createKey(authRequest, "No self-mint");

		const createRes = await app.handle(
			new Request("http://localhost/api/auth/api-keys", {
				body: JSON.stringify({ name: "minted by a key" }),
				headers: {
					authorization: `Bearer ${created.token}`,
					"Content-Type": "application/json",
				},
				method: "POST",
			}),
		);
		expect(createRes.status).toBe(403);

		const listRes = await app.handle(
			bearerRequest("/api/auth/api-keys", created.token),
		);
		expect(listRes.status).toBe(403);
	});
});
