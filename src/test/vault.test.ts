import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { storesController } from "@/modules/stores";
import { vaultController } from "@/modules/vault";
import { VAULT_PREFIX } from "@/modules/vault/credentials";
import { authGuard } from "@/test/setup";
import { seedTestStore } from "@/test/test-helpers";
import { encryptWithKey } from "@/utils/crypto";
import { db } from "@/utils/db";
import { stores, user, workspaceMembers, workspaces } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

// Dedicated user/workspace so vault setup/reset (which mutate ALL stores in the
// workspace) never touch the shared test workspace used by other suites.
const VAULT_USER = "vault-test-user";

const dek = randomBytes(32);
const verifier = encryptWithKey(dek, "appboard-vault-v1");
const setupBody = {
	dek: dek.toString("base64"),
	kdfParams: {
		algo: "argon2id",
		iterations: 3,
		memoryKiB: 65536,
		parallelism: 1,
	},
	kdfSalt: Buffer.from("salt").toString("base64"),
	verifier,
	wrapNonce: Buffer.from("nonce").toString("base64"),
	wrappedDek: Buffer.from("wrapped-dek").toString("base64"),
};

const app = new Elysia()
	.use(authGuard)
	.use(errorHandler)
	.group("/api", (a) => a.use(vaultController).use(storesController));

let vaultWorkspaceId: string;
let storeId: string;

function vaultReq(method: string, path: string, body?: unknown): Request {
	const headers = new Headers({ "x-test-user-id": VAULT_USER });
	const init: RequestInit = { headers, method };
	if (body) {
		headers.set("Content-Type", "application/json");
		init.body = JSON.stringify(body);
	}
	return new Request(`http://localhost${path}`, init);
}

async function json(res: Response) {
	return { data: await res.json(), status: res.status };
}

describe("Vault (E2EE credential encryption)", () => {
	beforeAll(async () => {
		await db
			.insert(user)
			.values({
				email: "vault@test.com",
				emailVerified: true,
				id: VAULT_USER,
				name: "Vault User",
			})
			.onConflictDoNothing();
		const [ws] = await db
			.insert(workspaces)
			.values({ name: "Vault Workspace" })
			.returning();
		vaultWorkspaceId = ws.id;
		await db.insert(workspaceMembers).values({
			role: "owner",
			userId: VAULT_USER,
			workspaceId: vaultWorkspaceId,
		});
		const store = await seedTestStore(vaultWorkspaceId);
		storeId = store.id;
	});

	afterAll(async () => {
		await app.handle(vaultReq("POST", "/api/vault/lock"));
		await db.delete(workspaces).where(eq(workspaces.id, vaultWorkspaceId));
		await db.delete(user).where(eq(user.id, VAULT_USER));
	});

	it("reports no vault before setup", async () => {
		const { data, status } = await json(
			await app.handle(vaultReq("GET", "/api/vault/status")),
		);
		expect(status).toBe(200);
		expect(data).toEqual({ exists: false, unlocked: false });
	});

	it("rejects sync... still works on a vault-less workspace (legacy env key)", async () => {
		const res = await app.handle(
			vaultReq("POST", `/api/stores/${storeId}/sync`),
		);
		expect(res.status).toBe(200); // env-key credentials, no vault yet
	});

	it("sets up the vault and migrates existing credentials to the DEK", async () => {
		const { data, status } = await json(
			await app.handle(vaultReq("POST", "/api/vault/setup", setupBody)),
		);
		expect(status).toBe(200);
		expect(data.migrated).toBe(1);

		const [row] = await db
			.select({ credentials: stores.credentials })
			.from(stores)
			.where(eq(stores.id, storeId));
		expect(row.credentials?.startsWith(VAULT_PREFIX)).toBe(true);
	});

	it("reports vault exists + unlocked after setup", async () => {
		const { data } = await json(
			await app.handle(vaultReq("GET", "/api/vault/status")),
		);
		expect(data).toEqual({ exists: true, unlocked: true });
	});

	it("rejects a second setup", async () => {
		const res = await app.handle(
			vaultReq("POST", "/api/vault/setup", setupBody),
		);
		expect(res.status).toBe(400);
	});

	it("decrypts credentials and syncs while unlocked", async () => {
		const res = await app.handle(
			vaultReq("POST", `/api/stores/${storeId}/sync`),
		);
		expect(res.status).toBe(200);
	});

	it("returns 423 for store operations once locked", async () => {
		await app.handle(vaultReq("POST", "/api/vault/lock"));
		const res = await app.handle(
			vaultReq("POST", `/api/stores/${storeId}/sync`),
		);
		expect(res.status).toBe(423);
	});

	it("rejects unlock with a wrong key (401)", async () => {
		const res = await app.handle(
			vaultReq("POST", "/api/vault/unlock", {
				dek: randomBytes(32).toString("base64"),
			}),
		);
		expect(res.status).toBe(401);
	});

	it("unlocks with the correct key and resumes operations", async () => {
		const unlock = await app.handle(
			vaultReq("POST", "/api/vault/unlock", { dek: dek.toString("base64") }),
		);
		expect(unlock.status).toBe(200);
		const sync = await app.handle(
			vaultReq("POST", `/api/stores/${storeId}/sync`),
		);
		expect(sync.status).toBe(200);
	});

	it("resets the vault and wipes encrypted credentials", async () => {
		const res = await app.handle(vaultReq("POST", "/api/vault/reset"));
		expect(res.status).toBe(200);

		const [row] = await db
			.select({ credentials: stores.credentials, status: stores.status })
			.from(stores)
			.where(eq(stores.id, storeId));
		expect(row.credentials).toBeNull();
		expect(row.status).toBe("disconnected");

		const { data } = await json(
			await app.handle(vaultReq("GET", "/api/vault/status")),
		);
		expect(data.exists).toBe(false);
	});

	it("saves store credentials without a vault using the server env key", async () => {
		// After reset there is no vault — passphrase encryption is opt-in, so
		// connecting a store falls back to server env-key encryption.
		const res = await app.handle(
			vaultReq("POST", "/api/stores/connect", {
				credentials: { mock: true, type: "mock" },
				name: "No Vault Store",
				type: "google_play",
			}),
		);
		expect(res.status).toBe(200);

		const [row] = await db
			.select({ credentials: stores.credentials })
			.from(stores)
			.where(eq(stores.name, "No Vault Store"));
		expect(row.credentials).toBeTruthy();
		expect(row.credentials?.startsWith(VAULT_PREFIX)).toBe(false);
	});

	it("isolates vaults across workspaces (B cannot read A's params)", async () => {
		// Re-create a vault, then confirm the shared test user (workspace A) does
		// not see this workspace's vault.
		await app.handle(vaultReq("POST", "/api/vault/setup", setupBody));
		const { authRequest } = await import("@/test/setup");
		const res = await app.handle(
			authRequest("http://localhost/api/vault/params"),
		);
		// Workspace A sees ONLY its own vault (created in global test setup),
		// never this workspace's params.
		expect(res.status).toBe(200);
		const params = (await res.json()) as { kdfSalt: string };
		expect(params.kdfSalt).toBe(Buffer.from("test-salt").toString("base64"));
		expect(params.kdfSalt).not.toBe(setupBody.kdfSalt);
	});

	it("refuses to disable a locked vault (423)", async () => {
		await app.handle(vaultReq("POST", "/api/vault/lock"));
		const res = await app.handle(vaultReq("POST", "/api/vault/disable"));
		expect(res.status).toBe(423);
	});

	it("disables the vault and re-encrypts credentials with the env key", async () => {
		await app.handle(
			vaultReq("POST", "/api/vault/unlock", { dek: dek.toString("base64") }),
		);
		const { data, status } = await json(
			await app.handle(vaultReq("POST", "/api/vault/disable")),
		);
		expect(status).toBe(200);
		expect(data.disabled).toBe(true);
		expect(data.migrated).toBe(1);

		const [row] = await db
			.select({ credentials: stores.credentials })
			.from(stores)
			.where(eq(stores.name, "No Vault Store"));
		expect(row.credentials).toBeTruthy();
		expect(row.credentials?.startsWith(VAULT_PREFIX)).toBe(false);

		const statusRes = await json(
			await app.handle(vaultReq("GET", "/api/vault/status")),
		);
		expect(statusRes.data).toEqual({ exists: false, unlocked: false });
	});

	it("refuses to disable when no vault exists (404)", async () => {
		const res = await app.handle(vaultReq("POST", "/api/vault/disable"));
		expect(res.status).toBe(404);
	});
});
