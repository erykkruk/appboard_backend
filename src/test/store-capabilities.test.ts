import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import {
	buildSetupPlan,
	resolveDefaultCapabilities,
	validateCapabilitySelection,
} from "@/config/store-capabilities";
import { purchasesController } from "@/modules/purchases";
import { storesController } from "@/modules/stores";
import { storeCapabilityGuard } from "@/modules/stores/store-capabilities.guard";
import { vaultActionGuard } from "@/modules/vault/vault.guard";
import { VaultService } from "@/modules/vault/vault.service";
import { encrypt, encryptWithKey } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	apps,
	stores,
	user,
	workspaceMembers,
	workspaces,
	workspaceVault,
} from "@/utils/db/schema";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	TEST_VAULT_DEK,
} from "./setup";

// App with the guards wired, mirroring the real registration order.
const app = new Elysia()
	.use(authGuard)
	.group("/api", (a) =>
		a
			.use(vaultActionGuard)
			.use(storeCapabilityGuard)
			.use(storesController)
			.use(purchasesController),
	);

function json(url: string, method: string, body?: unknown) {
	return authRequest(url, {
		body: body ? JSON.stringify(body) : undefined,
		headers: { "Content-Type": "application/json" },
		method,
	});
}

describe("store capabilities — pure selection logic", () => {
	it("defaults to all selectable capabilities per store type", () => {
		expect(resolveDefaultCapabilities("google_play")).toEqual([
			"listings",
			"assets",
			"reviews",
			"publishing",
			"purchases",
		]);
		// App Store additionally exposes age rating / categories / privacy.
		const asDefault = resolveDefaultCapabilities("app_store");
		expect(asDefault).toContain("age_rating");
		expect(asDefault).toContain("categories");
		expect(asDefault).toContain("privacy");
	});

	it("always includes core capabilities and drops unknown ids", () => {
		const result = validateCapabilitySelection("google_play", [
			"reviews",
			"not-a-real-capability",
		]);
		// listings + assets are core → always present; reviews kept; junk dropped.
		expect(result).toContain("listings");
		expect(result).toContain("assets");
		expect(result).toContain("reviews");
		expect(result).not.toContain("not-a-real-capability");
		expect(result).not.toContain("purchases");
	});

	it("drops console-only Google Play capabilities from a selection", () => {
		const result = validateCapabilitySelection("google_play", [
			"age_rating",
			"privacy",
			"categories",
		]);
		expect(result).not.toContain("age_rating");
		expect(result).not.toContain("privacy");
		expect(result).not.toContain("categories");
	});

	it("empty selection resolves to core only", () => {
		expect(validateCapabilitySelection("google_play", [])).toEqual([
			"listings",
			"assets",
		]);
	});

	it("builds a setup plan whose roles reflect the selection", () => {
		const withPurchases = buildSetupPlan("google_play", [
			"listings",
			"purchases",
		]);
		expect(withPurchases.gcpApis).toContain("androidpublisher.googleapis.com");
		expect(withPurchases.gcpApis).toContain(
			"playdeveloperreporting.googleapis.com",
		);
		expect(withPurchases.consoleRoles).toContain(
			"Manage orders and subscriptions",
		);

		const withoutPurchases = buildSetupPlan("google_play", ["listings"]);
		expect(withoutPurchases.consoleRoles).not.toContain(
			"Manage orders and subscriptions",
		);
	});
});

describe("store capabilities — catalog + persistence", () => {
	const createdStoreIds: string[] = [];

	afterAll(async () => {
		if (createdStoreIds.length > 0) await cleanupStores(createdStoreIds);
	});

	it("exposes the capability catalog + setup guidance", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/stores/capability-catalog"),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data.capabilities)).toBe(true);
		expect(data.capabilities.length).toBeGreaterThan(0);
		expect(data.setup.google_play.baseGcpApis).toContain(
			"androidpublisher.googleapis.com",
		);
	});

	it("persists an explicit (restricted) capability selection on connect", async () => {
		const res = await app.handle(
			json("http://localhost/api/stores/connect", "POST", {
				capabilities: ["listings", "reviews"],
				credentials: { mock: true, type: "mock" },
				name: "Restricted GP",
				type: "google_play",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		createdStoreIds.push(data.store.id);

		// reviews kept; core assets added; purchases NOT granted.
		expect(data.capabilities).toContain("listings");
		expect(data.capabilities).toContain("assets");
		expect(data.capabilities).toContain("reviews");
		expect(data.capabilities).not.toContain("purchases");

		const getRes = await app.handle(
			authRequest(`http://localhost/api/stores/${data.store.id}/capabilities`),
		);
		expect(getRes.status).toBe(200);
		const getData = await getRes.json();
		expect(getData.storeType).toBe("google_play");
		expect(getData.capabilities).not.toContain("purchases");
	});

	it("connect without a selection grants all selectable capabilities", async () => {
		const res = await app.handle(
			json("http://localhost/api/stores/connect", "POST", {
				credentials: { mock: true, type: "mock" },
				name: "Default GP",
				type: "google_play",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		createdStoreIds.push(data.store.id);
		expect(data.capabilities).toContain("purchases");
		expect(data.capabilities).toContain("publishing");
	});

	it("PATCH updates a connection's capabilities", async () => {
		const res = await app.handle(
			json("http://localhost/api/stores/connect", "POST", {
				credentials: { mock: true, type: "mock" },
				name: "Patch GP",
				type: "google_play",
			}),
		);
		const data = await res.json();
		createdStoreIds.push(data.store.id);

		const patchRes = await app.handle(
			json(
				`http://localhost/api/stores/${data.store.id}/capabilities`,
				"PATCH",
				{ capabilities: ["listings"] },
			),
		);
		expect(patchRes.status).toBe(200);
		const patched = await patchRes.json();
		// listings + core assets only.
		expect(patched.capabilities).toEqual(["listings", "assets"]);
	});

	it("workspace B cannot read or edit workspace A capabilities", async () => {
		const res = await app.handle(
			json("http://localhost/api/stores/connect", "POST", {
				credentials: { mock: true, type: "mock" },
				name: "Isolation GP",
				type: "google_play",
			}),
		);
		const data = await res.json();
		createdStoreIds.push(data.store.id);

		const getRes = await app.handle(
			authRequestB(`http://localhost/api/stores/${data.store.id}/capabilities`),
		);
		expect(getRes.status).toBe(404);

		const patchRes = await app.handle(
			authRequestB(
				`http://localhost/api/stores/${data.store.id}/capabilities`,
				{
					body: JSON.stringify({ capabilities: ["listings"] }),
					headers: { "Content-Type": "application/json" },
					method: "PATCH",
				},
			),
		);
		expect(patchRes.status).toBe(404);
	});
});

describe("store capability gating (403)", () => {
	const storeIds: string[] = [];

	afterAll(async () => {
		if (storeIds.length > 0) await cleanupStores(storeIds);
	});

	async function seedStoreWithCaps(capabilities: string[] | null) {
		const [store] = await db
			.insert(stores)
			.values({
				capabilities,
				credentials: encrypt(JSON.stringify({ mock: true })),
				name: "Gating Store",
				status: "connected",
				type: "google_play",
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		storeIds.push(store.id);
		const [appRow] = await db
			.insert(apps)
			.values({
				bundleId: "com.test.gate",
				externalId: `com.test.gate.${store.id}`,
				name: "Gate App",
				platform: "android",
				storeId: store.id,
			})
			.returning();
		return appRow.id;
	}

	it("blocks purchases routes when the connection lacks the purchases capability", async () => {
		const appId = await seedStoreWithCaps(["listings", "assets", "reviews"]);
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/purchases/capabilities`),
		);
		expect(res.status).toBe(403);
	});

	it("allows purchases routes when the capability is present (default)", async () => {
		const appId = await seedStoreWithCaps(null); // null → all selectable
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appId}/purchases/capabilities`),
		);
		// The guard must not block it; the handler may return 200/5xx but never 403.
		expect(res.status).not.toBe(403);
	});
});

describe("hard vault guard (423) on store actions", () => {
	const LOCKED_WORKSPACE_ID = "b0000000-0000-0000-0000-0000000000c3";
	const LOCKED_USER_ID = "test-user-locked-vault";

	beforeAll(async () => {
		await db
			.insert(user)
			.values({
				email: "locked@test.com",
				emailVerified: true,
				id: LOCKED_USER_ID,
				name: "Locked User",
			})
			.onConflictDoNothing();
		await db
			.insert(workspaces)
			.values({ id: LOCKED_WORKSPACE_ID, name: "Locked Workspace" })
			.onConflictDoNothing();
		await db
			.insert(workspaceMembers)
			.values({
				role: "owner",
				userId: LOCKED_USER_ID,
				workspaceId: LOCKED_WORKSPACE_ID,
			})
			.onConflictDoNothing();
		// Vault row exists but is NEVER unlocked in-memory → locked.
		await db
			.insert(workspaceVault)
			.values({
				kdfParams: {
					algo: "argon2id",
					iterations: 3,
					memoryKiB: 65536,
					parallelism: 1,
				},
				kdfSalt: Buffer.from("locked-salt").toString("base64"),
				verifier: encryptWithKey(TEST_VAULT_DEK, "appboard-vault-v1"),
				workspaceId: LOCKED_WORKSPACE_ID,
				wrapNonce: Buffer.from("locked-nonce").toString("base64"),
				wrappedDek: Buffer.from("locked-wrapped-dek").toString("base64"),
			})
			.onConflictDoNothing();
	});

	afterAll(async () => {
		// Cascades remove the member + vault row; drop the user separately.
		await db.delete(workspaces).where(eq(workspaces.id, LOCKED_WORKSPACE_ID));
		await db.delete(user).where(eq(user.id, LOCKED_USER_ID));
	});

	function lockedRequest(url: string, method: string, body?: unknown) {
		const headers = new Headers({ "Content-Type": "application/json" });
		headers.set("x-test-user-id", LOCKED_USER_ID);
		return new Request(url, {
			body: body ? JSON.stringify(body) : undefined,
			headers,
			method,
		});
	}

	it("returns 423 for a mutating store action while the vault is locked", async () => {
		const res = await app.handle(
			lockedRequest("http://localhost/api/stores/connect", "POST", {
				credentials: { mock: true, type: "mock" },
				name: "Should Not Connect",
				type: "google_play",
			}),
		);
		expect(res.status).toBe(423);
	});

	it("assertUnlockedForAction: locked throws, no-vault + unlocked pass", async () => {
		// Locked vault → throws.
		let threw = false;
		try {
			await VaultService.assertUnlockedForAction(LOCKED_WORKSPACE_ID);
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);

		// No vault configured → passes (lets the credential layer decide).
		await expect(
			VaultService.assertUnlockedForAction(
				"b0000000-0000-0000-0000-0000000000ff",
			),
		).resolves.toBeUndefined();

		// Workspace A vault is unlocked in test setup → passes.
		await expect(
			VaultService.assertUnlockedForAction(getTestWorkspaceId()),
		).resolves.toBeUndefined();
	});

	it("raw verify-access is reachable while the vault is locked", async () => {
		const res = await app.handle(
			lockedRequest("http://localhost/api/stores/verify-access", "POST", {
				credentials: { mock: true, type: "mock" },
				type: "google_play",
			}),
		);
		// Excluded from the vault guard — probing raw credentials stores nothing.
		expect(res.status).not.toBe(423);
		expect(res.status).toBe(200);
	});
});

describe("capability access verification", () => {
	const storeIds: string[] = [];

	afterAll(async () => {
		if (storeIds.length > 0) await cleanupStores(storeIds);
	});

	function statusOf(
		results: Array<{ id: string; status: string }>,
		id: string,
	) {
		return results.find((r) => r.id === id)?.status;
	}

	it("raw verify-access reports per-capability access for Google Play", async () => {
		const res = await app.handle(
			json("http://localhost/api/stores/verify-access", "POST", {
				credentials: { mock: true, type: "mock" },
				type: "google_play",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.storeType).toBe("google_play");
		expect(statusOf(data.results, "listings")).toBe("granted");
		expect(statusOf(data.results, "purchases")).toBe("granted");
		// Play Console-only capabilities cannot be verified via the key.
		expect(statusOf(data.results, "age_rating")).toBe("unsupported");
	});

	it("raw verify-access reports per-capability access for App Store", async () => {
		const res = await app.handle(
			json("http://localhost/api/stores/verify-access", "POST", {
				credentials: { mock: true },
				type: "app_store",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.storeType).toBe("app_store");
		expect(statusOf(data.results, "listings")).toBe("granted");
		expect(statusOf(data.results, "reviews")).toBe("granted");
		expect(statusOf(data.results, "purchases")).toBe("granted");
	});

	it("verifies access for an already-connected store", async () => {
		const [store] = await db
			.insert(stores)
			.values({
				credentials: encrypt(JSON.stringify({ mock: true })),
				name: "Verify Store",
				status: "connected",
				type: "google_play",
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		storeIds.push(store.id);

		const res = await app.handle(
			authRequest(`http://localhost/api/stores/${store.id}/verify-access`, {
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(statusOf(data.results, "listings")).toBe("granted");
	});
});
