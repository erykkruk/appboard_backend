import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { AIService } from "@/modules/ai/ai.service";
import { appGroupsController } from "@/modules/app-groups";
import { asoProfileController } from "@/modules/aso-profile";
import { groupAsoProfileController } from "@/modules/group-aso-profile";
import { db } from "@/utils/db";
import { appGroups, apps } from "@/utils/db/schema";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "./setup";
import { seedTestApp, seedTestStore } from "./test-helpers";

const GROUP_BASE = "http://localhost/api/app-groups";

const createdStoreIds: string[] = [];
const createdGroupIds: string[] = [];

describe("Group ASO Profile", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) =>
			app
				.use(appGroupsController)
				.use(groupAsoProfileController)
				.use(asoProfileController),
		);

	let storeA: { id: string };
	let appA: { id: string };
	let groupId: string;

	let storeB: { id: string };
	let groupIdB: string;

	afterAll(async () => {
		for (const id of createdGroupIds) {
			await db.delete(appGroups).where(eq(appGroups.id, id));
		}
		await cleanupStores(createdStoreIds);
	});

	it("seeds test data", async () => {
		storeA = await seedTestStore(getTestWorkspaceId());
		createdStoreIds.push(storeA.id);
		appA = await seedTestApp(storeA.id);

		// Create group and add app
		const groupRes = await app
			.handle(
				authRequest(GROUP_BASE, {
					body: JSON.stringify({ name: "Profile Group" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());
		groupId = groupRes.appGroup.id;
		createdGroupIds.push(groupId);

		await app.handle(
			authRequest(`${GROUP_BASE}/${groupId}/members`, {
				body: JSON.stringify({ appId: appA.id }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		// Workspace B group
		storeB = await seedTestStore(getTestWorkspaceIdB());
		createdStoreIds.push(storeB.id);

		const groupBRes = await app
			.handle(
				authRequestB(GROUP_BASE, {
					body: JSON.stringify({ name: "Group B" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());
		groupIdB = groupBRes.appGroup.id;
		createdGroupIds.push(groupIdB);
	});

	// ── GET group ASO profile ─────────────────────────────────────────

	it("GET returns null profile and useSharedProfile=false initially", async () => {
		const res = await app
			.handle(authRequest(`${GROUP_BASE}/${groupId}/aso-profile`))
			.then((r) => r.json());

		expect(res.asoProfile).toBeNull();
		expect(res.useSharedProfile).toBe(false);
	});

	// ── PUT when useSharedProfile is off → 400 ──────────────────────

	it("PUT returns 400 when useSharedProfile is false", async () => {
		const res = await app.handle(
			authRequest(`${GROUP_BASE}/${groupId}/aso-profile`, {
				body: JSON.stringify({ oneLiner: "Test" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(400);
	});

	// ── Enable shared profile ─────────────────────────────────────────

	it("enables useSharedProfile on group", async () => {
		const res = await app
			.handle(
				authRequest(`${GROUP_BASE}/${groupId}`, {
					body: JSON.stringify({ useSharedProfile: true }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((r) => r.json());

		expect(res.appGroup.useSharedProfile).toBe(true);
	});

	// ── PUT group ASO profile ─────────────────────────────────────────

	it("PUT upserts group ASO profile", async () => {
		const res = await app
			.handle(
				authRequest(`${GROUP_BASE}/${groupId}/aso-profile`, {
					body: JSON.stringify({
						category: "Productivity",
						keyFeatures: ["Feature A", "Feature B"],
						oneLiner: "Best app ever",
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((r) => r.json());

		expect(res.asoProfile).toBeDefined();
		expect(res.asoProfile.oneLiner).toBe("Best app ever");
		expect(res.asoProfile.category).toBe("Productivity");
		expect(res.asoProfile.keyFeatures).toEqual(["Feature A", "Feature B"]);
	});

	it("GET returns profile after upsert", async () => {
		const res = await app
			.handle(authRequest(`${GROUP_BASE}/${groupId}/aso-profile`))
			.then((r) => r.json());

		expect(res.asoProfile.oneLiner).toBe("Best app ever");
		expect(res.useSharedProfile).toBe(true);
	});

	// ── App-level lock ────────────────────────────────────────────────

	it("App GET returns locked=true when group has shared profile", async () => {
		const res = await app
			.handle(authRequest(`http://localhost/api/apps/${appA.id}/aso-profile`))
			.then((r) => r.json());

		expect(res.locked).toBe(true);
		expect(res.groupId).toBe(groupId);
	});

	it("App PUT returns 403 when group has shared profile", async () => {
		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${appA.id}/aso-profile`, {
				body: JSON.stringify({ oneLiner: "Hacked" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		expect(res.status).toBe(403);
	});

	// ── Workspace isolation ───────────────────────────────────────────

	it("workspace B cannot access workspace A group profile", async () => {
		const res = await app.handle(
			authRequestB(`${GROUP_BASE}/${groupId}/aso-profile`),
		);
		expect(res.status).toBe(404);
	});

	it("workspace B cannot update workspace A group profile", async () => {
		const res = await app.handle(
			authRequestB(`${GROUP_BASE}/${groupId}/aso-profile`, {
				body: JSON.stringify({ oneLiner: "Hacked" }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);
		expect(res.status).toBe(404);
	});

	// ── resolveAsoProfile ────────────────────────────────────────────

	it("resolveAsoProfile returns group profile when shared is enabled", async () => {
		const profile = await AIService.resolveAsoProfile(appA.id);

		expect(profile).not.toBeNull();
		expect(profile!.oneLiner).toBe("Best app ever");
		expect(profile!.category).toBe("Productivity");
	});

	it("resolveAsoProfile returns app profile when shared is disabled", async () => {
		// Disable shared profile
		await app.handle(
			authRequest(`${GROUP_BASE}/${groupId}`, {
				body: JSON.stringify({ useSharedProfile: false }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);

		const profile = await AIService.resolveAsoProfile(appA.id);

		// App profile was never explicitly set, so it should be null
		expect(profile).toBeNull();

		// Re-enable for subsequent tests
		await app.handle(
			authRequest(`${GROUP_BASE}/${groupId}`, {
				body: JSON.stringify({ useSharedProfile: true }),
				headers: { "Content-Type": "application/json" },
				method: "PUT",
			}),
		);
	});

	it("resolveAsoProfile returns app profile for app not in any group", async () => {
		const soloBundle = `com.test.solo.${Date.now()}`;
		const [soloApp] = await db
			.insert(apps)
			.values({
				bundleId: soloBundle,
				externalId: soloBundle,
				name: "Solo App",
				platform: "android",
				storeId: storeA.id,
			})
			.returning();
		const profile = await AIService.resolveAsoProfile(soloApp.id);

		// No profile set for this app
		expect(profile).toBeNull();
	});
});
