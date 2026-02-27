import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appGroupsController } from "@/modules/app-groups";
import { db } from "@/utils/db";
import { appGroups } from "@/utils/db/schema";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "./setup";
import { seedTestApp, seedTestStore } from "./test-helpers";

const BASE = "http://localhost/api/app-groups";

const createdStoreIds: string[] = [];
const createdGroupIds: string[] = [];

describe("App Groups module", () => {
	const app = new Elysia()
		.use(authGuard)
		.group("/api", (app) => app.use(appGroupsController));

	let storeA: { id: string };
	let appAndroid: { id: string };
	let appIos: { id: string };
	let storeB: { id: string };
	let appB: { id: string };

	afterAll(async () => {
		for (const id of createdGroupIds) {
			await db.delete(appGroups).where(eq(appGroups.id, id));
		}
		await cleanupStores(createdStoreIds);
	});

	it("seeds test data", async () => {
		storeA = await seedTestStore(getTestWorkspaceId());
		createdStoreIds.push(storeA.id);

		appAndroid = await seedTestApp(storeA.id);

		// Create an iOS app in the same store
		const [iosApp] = await db
			.insert((await import("@/utils/db/schema")).apps)
			.values({
				bundleId: "com.test.iosapp",
				externalId: "com.test.iosapp",
				iconUrl: "https://placehold.co/512x512",
				name: "Test iOS App",
				platform: "ios",
				storeId: storeA.id,
			})
			.returning();
		appIos = iosApp;

		// Workspace B store + app
		storeB = await seedTestStore(getTestWorkspaceIdB());
		createdStoreIds.push(storeB.id);
		appB = await seedTestApp(storeB.id);
	});

	// ── CRUD ──────────────────────────────────────────────────────────

	it("POST /app-groups creates a group", async () => {
		const res = await app
			.handle(
				authRequest(BASE, {
					body: JSON.stringify({ name: "My App" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());

		expect(res.appGroup).toBeDefined();
		expect(res.appGroup.name).toBe("My App");
		expect(res.appGroup.id).toBeDefined();
		createdGroupIds.push(res.appGroup.id);
	});

	it("GET /app-groups lists groups", async () => {
		const res = await app
			.handle(authRequest(BASE))
			.then((r) => r.json());

		expect(res.appGroups).toBeArray();
		expect(res.appGroups.length).toBeGreaterThanOrEqual(1);
	});

	it("GET /app-groups/:groupId gets group details", async () => {
		const groupId = createdGroupIds[0];
		const res = await app
			.handle(authRequest(`${BASE}/${groupId}`))
			.then((r) => r.json());

		expect(res.appGroup.id).toBe(groupId);
		expect(res.appGroup.name).toBe("My App");
		expect(res.appGroup.members).toBeArray();
	});

	it("PUT /app-groups/:groupId updates a group", async () => {
		const groupId = createdGroupIds[0];
		const res = await app
			.handle(
				authRequest(`${BASE}/${groupId}`, {
					body: JSON.stringify({ name: "Renamed App" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			)
			.then((r) => r.json());

		expect(res.appGroup.name).toBe("Renamed App");
	});

	// ── Members ───────────────────────────────────────────────────────

	it("POST /app-groups/:groupId/members adds an app", async () => {
		const groupId = createdGroupIds[0];
		const res = await app
			.handle(
				authRequest(`${BASE}/${groupId}/members`, {
					body: JSON.stringify({ appId: appAndroid.id }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());

		expect(res.member).toBeDefined();
		expect(res.member.appId).toBe(appAndroid.id);
	});

	it("rejects duplicate platform in group", async () => {
		// Create another android app
		const [anotherAndroid] = await db
			.insert((await import("@/utils/db/schema")).apps)
			.values({
				bundleId: "com.test.another",
				externalId: "com.test.another",
				name: "Another Android",
				platform: "android",
				storeId: storeA.id,
			})
			.returning();

		const groupId = createdGroupIds[0];
		const res = await app.handle(
			authRequest(`${BASE}/${groupId}/members`, {
				body: JSON.stringify({ appId: anotherAndroid.id }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(400);
	});

	it("allows different platform in same group", async () => {
		const groupId = createdGroupIds[0];
		const res = await app
			.handle(
				authRequest(`${BASE}/${groupId}/members`, {
					body: JSON.stringify({ appId: appIos.id }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());

		expect(res.member.appId).toBe(appIos.id);
	});

	it("rejects app already in another group", async () => {
		// Create a second group
		const group2Res = await app
			.handle(
				authRequest(BASE, {
					body: JSON.stringify({ name: "Second Group" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			)
			.then((r) => r.json());
		createdGroupIds.push(group2Res.appGroup.id);

		// Try to add appAndroid (already in first group)
		const res = await app.handle(
			authRequest(`${BASE}/${group2Res.appGroup.id}/members`, {
				body: JSON.stringify({ appId: appAndroid.id }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);

		expect(res.status).toBe(400);
	});

	it("GET /app-groups/:groupId returns members with app info", async () => {
		const groupId = createdGroupIds[0];
		const res = await app
			.handle(authRequest(`${BASE}/${groupId}`))
			.then((r) => r.json());

		expect(res.appGroup.members.length).toBe(2);
		const member = res.appGroup.members[0];
		expect(member.app).toBeDefined();
		expect(member.app.platform).toBeDefined();
		expect(member.app.bundleId).toBeDefined();
	});

	it("DELETE /app-groups/:groupId/members/:appId removes member", async () => {
		const groupId = createdGroupIds[0];
		const res = await app
			.handle(
				authRequest(`${BASE}/${groupId}/members/${appIos.id}`, {
					method: "DELETE",
				}),
			)
			.then((r) => r.json());

		expect(res.success).toBe(true);

		// Verify member count
		const getRes = await app
			.handle(authRequest(`${BASE}/${groupId}`))
			.then((r) => r.json());
		expect(getRes.appGroup.members.length).toBe(1);
	});

	it("DELETE /app-groups/:groupId deletes a group", async () => {
		// Delete second group
		const groupId = createdGroupIds[1];
		const res = await app
			.handle(
				authRequest(`${BASE}/${groupId}`, { method: "DELETE" }),
			)
			.then((r) => r.json());

		expect(res.success).toBe(true);

		// Verify it's gone
		const getRes = await app.handle(authRequest(`${BASE}/${groupId}`));
		expect(getRes.status).toBe(404);
	});

	// ── Reorder ──────────────────────────────────────────────────────

	describe("reorder", () => {
		let groupA: string;
		let groupB: string;
		let groupC: string;

		it("seeds reorder test data", async () => {
			// Re-add iOS to first group for member reorder tests
			const groupId = createdGroupIds[0];
			await app.handle(
				authRequest(`${BASE}/${groupId}/members`, {
					body: JSON.stringify({ appId: appIos.id }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);

			// Create groups for reorder
			const resA = await app
				.handle(
					authRequest(BASE, {
						body: JSON.stringify({ name: "Reorder A" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					}),
				)
				.then((r) => r.json());
			groupA = resA.appGroup.id;
			createdGroupIds.push(groupA);

			const resB = await app
				.handle(
					authRequest(BASE, {
						body: JSON.stringify({ name: "Reorder B" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					}),
				)
				.then((r) => r.json());
			groupB = resB.appGroup.id;
			createdGroupIds.push(groupB);

			const resC = await app
				.handle(
					authRequest(BASE, {
						body: JSON.stringify({ name: "Reorder C" }),
						headers: { "Content-Type": "application/json" },
						method: "POST",
					}),
				)
				.then((r) => r.json());
			groupC = resC.appGroup.id;
			createdGroupIds.push(groupC);
		});

		it("new groups get auto-incremented sortOrder", async () => {
			const res = await app
				.handle(authRequest(BASE))
				.then((r) => r.json());

			const sorted = res.appGroups as Array<{
				id: string;
				sortOrder: number;
			}>;
			// Each group should have a unique sortOrder
			const orders = sorted.map((g) => g.sortOrder);
			expect(new Set(orders).size).toBe(orders.length);
			// Should be in ascending order
			for (let i = 1; i < orders.length; i++) {
				expect(orders[i]).toBeGreaterThan(orders[i - 1]);
			}
		});

		it("PUT /app-groups/reorder changes group order", async () => {
			// Reorder: C, A, B (reversed from creation)
			const res = await app
				.handle(
					authRequest(`${BASE}/reorder`, {
						body: JSON.stringify({
							groupIds: [groupC, groupA, groupB],
						}),
						headers: { "Content-Type": "application/json" },
						method: "PUT",
					}),
				)
				.then((r) => r.json());

			expect(res.success).toBe(true);

			// Verify list returns in new order
			const listRes = await app
				.handle(authRequest(BASE))
				.then((r) => r.json());

			const reorderedIds = (
				listRes.appGroups as Array<{ id: string }>
			).map((g) => g.id);
			// C, A, B should appear in order (other groups may appear before/after)
			const cIdx = reorderedIds.indexOf(groupC);
			const aIdx = reorderedIds.indexOf(groupA);
			const bIdx = reorderedIds.indexOf(groupB);
			expect(cIdx).toBeLessThan(aIdx);
			expect(aIdx).toBeLessThan(bIdx);
		});

		it("PUT /app-groups/:groupId/reorder changes member order", async () => {
			const groupId = createdGroupIds[0];

			// Reorder members: iOS first, then Android
			const res = await app
				.handle(
					authRequest(`${BASE}/${groupId}/reorder`, {
						body: JSON.stringify({
							appIds: [appIos.id, appAndroid.id],
						}),
						headers: { "Content-Type": "application/json" },
						method: "PUT",
					}),
				)
				.then((r) => r.json());

			expect(res.success).toBe(true);

			// Verify member order
			const getRes = await app
				.handle(authRequest(`${BASE}/${groupId}`))
				.then((r) => r.json());

			const memberAppIds = getRes.appGroup.members.map(
				(m: { appId: string }) => m.appId,
			);
			expect(memberAppIds[0]).toBe(appIos.id);
			expect(memberAppIds[1]).toBe(appAndroid.id);
		});

		it("rejects reorder with invalid group IDs", async () => {
			const res = await app.handle(
				authRequest(`${BASE}/reorder`, {
					body: JSON.stringify({
						groupIds: [
							groupA,
							"00000000-0000-0000-0000-000000000099",
						],
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			expect(res.status).toBe(400);
		});

		it("rejects member reorder with wrong app list", async () => {
			const groupId = createdGroupIds[0];

			// Wrong app ID
			const res = await app.handle(
				authRequest(`${BASE}/${groupId}/reorder`, {
					body: JSON.stringify({
						appIds: ["00000000-0000-0000-0000-000000000099"],
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			expect(res.status).toBe(400);
		});

		it("workspace B cannot reorder workspace A groups", async () => {
			const res = await app.handle(
				authRequestB(`${BASE}/reorder`, {
					body: JSON.stringify({ groupIds: [groupA, groupB] }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			expect(res.status).toBe(400);
		});

		it("workspace B cannot reorder workspace A group members", async () => {
			const groupId = createdGroupIds[0];
			const res = await app.handle(
				authRequestB(`${BASE}/${groupId}/reorder`, {
					body: JSON.stringify({
						appIds: [appIos.id, appAndroid.id],
					}),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);

			expect(res.status).toBe(404);
		});
	});

	// ── Workspace isolation ───────────────────────────────────────────

	describe("workspace isolation", () => {
		it("workspace B cannot see workspace A groups", async () => {
			const res = await app
				.handle(authRequestB(BASE))
				.then((r) => r.json());

			expect(res.appGroups).toBeArray();
			expect(res.appGroups.length).toBe(0);
		});

		it("workspace B cannot access workspace A group by ID", async () => {
			const groupId = createdGroupIds[0];
			const res = await app.handle(authRequestB(`${BASE}/${groupId}`));
			expect(res.status).toBe(404);
		});

		it("workspace B cannot update workspace A group", async () => {
			const groupId = createdGroupIds[0];
			const res = await app.handle(
				authRequestB(`${BASE}/${groupId}`, {
					body: JSON.stringify({ name: "Hacked" }),
					headers: { "Content-Type": "application/json" },
					method: "PUT",
				}),
			);
			expect(res.status).toBe(404);
		});

		it("workspace B cannot delete workspace A group", async () => {
			const groupId = createdGroupIds[0];
			const res = await app.handle(
				authRequestB(`${BASE}/${groupId}`, { method: "DELETE" }),
			);
			expect(res.status).toBe(404);
		});

		it("workspace B cannot add its app to workspace A group", async () => {
			const groupId = createdGroupIds[0];
			const res = await app.handle(
				authRequestB(`${BASE}/${groupId}/members`, {
					body: JSON.stringify({ appId: appB.id }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);
			expect(res.status).toBe(404);
		});
	});
});
