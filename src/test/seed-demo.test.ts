import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { getTestWorkspaceId, getTestWorkspaceIdB } from "@/test/setup";
import { db } from "@/utils/db";
import {
	appAsoProfiles,
	appGroupMembers,
	appGroups,
	apps,
	appVersions,
	assets,
	groupAsoProfiles,
	inAppPurchases,
	listingHistory,
	listings,
	reviews,
	stores,
	user,
	workspaces,
} from "@/utils/db/schema";
import { DEMO, type SeedDemoResult, seedDemo } from "../../scripts/seed-demo";

// Isolated identity so this suite never collides with (or deletes) the real
// `demo@appboard.dev` demo data created by `bun run db:seed:demo`.
const TEST_CFG = {
	auraGroupName: "Demo Seed Test Aura Group",
	email: "demo-seed-test@appboard.dev",
	groupName: "Demo Seed Test Group",
	iosStoreName: "Demo Seed Test — App Store",
	name: "Demo Seed Test",
	password: "demo-seed-test-123",
	storeName: "Demo Seed Test — Google Play",
	workspaceName: "Demo Seed Test WS",
};

async function storeCount(workspaceId: string): Promise<number> {
	const rows = await db
		.select({ id: stores.id })
		.from(stores)
		.where(eq(stores.workspaceId, workspaceId));
	return rows.length;
}

describe("Demo seed script (seedDemo)", () => {
	let result: SeedDemoResult;
	let baselineA: number;
	let baselineB: number;

	beforeAll(async () => {
		baselineA = await storeCount(getTestWorkspaceId());
		baselineB = await storeCount(getTestWorkspaceIdB());
		result = await seedDemo(TEST_CFG);
	});

	afterAll(async () => {
		// Cascade: deleting the workspace removes members + stores → apps → all
		// listing/history/asset/review/version/purchase rows. Deleting the user
		// removes its better-auth account/session rows.
		if (result?.workspaceId) {
			await db.delete(workspaces).where(eq(workspaces.id, result.workspaceId));
		}
		if (result?.userId) {
			await db.delete(user).where(eq(user.id, result.userId));
		}
	});

	it("creates a loginable demo user, workspace and a connected Google Play store", async () => {
		expect(result.created).toBe(true);
		expect(result.userId).toBeTruthy();
		expect(result.workspaceId).toBeTruthy();
		expect(result.storeId).toBeTruthy();

		const [u] = await db
			.select({ email: user.email })
			.from(user)
			.where(eq(user.id, result.userId))
			.limit(1);
		expect(u?.email).toBe(TEST_CFG.email);

		const [ws] = await db
			.select({ name: workspaces.name })
			.from(workspaces)
			.where(eq(workspaces.id, result.workspaceId))
			.limit(1);
		expect(ws?.name).toBe(TEST_CFG.workspaceName);

		const [store] = await db
			.select()
			.from(stores)
			.where(eq(stores.id, result.storeId as string))
			.limit(1);
		expect(store?.type).toBe("google_play");
		expect(store?.status).toBe("connected");
		expect(store?.workspaceId).toBe(result.workspaceId);
	});

	it("creates three Android apps with icons (Lumina + Aura + Pulse)", async () => {
		const appRows = await db
			.select()
			.from(apps)
			.where(eq(apps.storeId, result.storeId as string));

		expect(appRows).toHaveLength(3);
		for (const a of appRows) {
			expect(a.platform).toBe("android");
			expect(a.iconUrl).toBeTruthy();
		}
		const names = appRows.map((a) => a.name).sort();
		expect(names).toEqual([
			"Aura – Sleep & Focus",
			"Lumina – Habit Tracker",
			"Pulse – Workout Tracker",
		]);
	});

	it("fully populates Lumina with listings, history, ASO, reviews, screenshots, version and IAP", async () => {
		const appId = result.luminaId as string;

		const listingRows = await db
			.select({ id: listings.id })
			.from(listings)
			.where(eq(listings.appId, appId));
		expect(listingRows).toHaveLength(6); // 3 languages × (remote + draft)

		const historyRows = await db
			.select({ id: listingHistory.id })
			.from(listingHistory)
			.where(eq(listingHistory.appId, appId));
		expect(historyRows).toHaveLength(7);

		const [aso] = await db
			.select()
			.from(appAsoProfiles)
			.where(eq(appAsoProfiles.appId, appId));
		expect(aso).toBeDefined();
		expect(aso.oneLiner).toBeTruthy();
		expect(aso.competitors?.length).toBeGreaterThan(0);

		const reviewRows = await db
			.select({ id: reviews.id })
			.from(reviews)
			.where(eq(reviews.appId, appId));
		expect(reviewRows).toHaveLength(6);

		const screenshotRows = await db
			.select({ id: assets.id })
			.from(assets)
			.where(and(eq(assets.appId, appId), eq(assets.assetType, "screenshot")));
		expect(screenshotRows).toHaveLength(15); // 3 languages × 5

		const iconRows = await db
			.select({ id: assets.id })
			.from(assets)
			.where(and(eq(assets.appId, appId), eq(assets.assetType, "icon")));
		expect(iconRows).toHaveLength(1);

		const versionRows = await db
			.select({ id: appVersions.id })
			.from(appVersions)
			.where(eq(appVersions.appId, appId));
		expect(versionRows).toHaveLength(1);

		const iapRows = await db
			.select({ id: inAppPurchases.id })
			.from(inAppPurchases)
			.where(eq(inAppPurchases.appId, appId));
		expect(iapRows).toHaveLength(1);
	});

	it("fully populates Pulse with listings, history, ASO, reviews, screenshots, version and IAP", async () => {
		const appId = result.pulseId as string;
		expect(appId).toBeTruthy();

		const [pulseApp] = await db
			.select()
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);
		expect(pulseApp?.platform).toBe("android");
		expect(pulseApp?.bundleId).toBe("com.pulse.workout");
		expect(pulseApp?.storeId).toBe(result.storeId as string);

		const listingRows = await db
			.select({ id: listings.id })
			.from(listings)
			.where(eq(listings.appId, appId));
		expect(listingRows).toHaveLength(4); // 2 languages × (remote + draft)

		const historyRows = await db
			.select({ id: listingHistory.id })
			.from(listingHistory)
			.where(eq(listingHistory.appId, appId));
		expect(historyRows).toHaveLength(3);

		const [aso] = await db
			.select()
			.from(appAsoProfiles)
			.where(eq(appAsoProfiles.appId, appId));
		expect(aso).toBeDefined();
		expect(aso.oneLiner).toBeTruthy();
		expect(aso.competitors?.length).toBeGreaterThan(0);

		const reviewRows = await db
			.select({ id: reviews.id })
			.from(reviews)
			.where(eq(reviews.appId, appId));
		expect(reviewRows).toHaveLength(5);

		const shotRows = await db
			.select({ id: assets.id })
			.from(assets)
			.where(and(eq(assets.appId, appId), eq(assets.assetType, "screenshot")));
		expect(shotRows).toHaveLength(10); // 2 languages × 5

		const versionRows = await db
			.select({ id: appVersions.id })
			.from(appVersions)
			.where(eq(appVersions.appId, appId));
		expect(versionRows).toHaveLength(1);

		const iapRows = await db
			.select({ id: inAppPurchases.id })
			.from(inAppPurchases)
			.where(eq(inAppPurchases.appId, appId));
		expect(iapRows).toHaveLength(1);
	});

	it("builds a description history timeline ordered by explicit createdAt", async () => {
		const rows = await db
			.select({ createdAt: listingHistory.createdAt })
			.from(listingHistory)
			.where(eq(listingHistory.appId, result.luminaId as string))
			.orderBy(asc(listingHistory.createdAt));

		const times = rows.map((r) => new Date(r.createdAt).getTime());
		// Multiple distinct dates → the timeline did not collapse to "now".
		expect(new Set(times).size).toBeGreaterThan(1);
		// Strictly non-decreasing when sorted.
		for (let i = 1; i < times.length; i++) {
			expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
		}
		// Earliest entry is the seeded 2026 origin date, not the run time.
		expect(new Date(times[0]).getUTCFullYear()).toBe(2026);
		expect(times[0]).toBeLessThan(Date.now());
	});

	it("seeds Google Play screenshots with renderable placeholder URLs", async () => {
		const shots = await db
			.select()
			.from(assets)
			.where(
				and(
					eq(assets.appId, result.luminaId as string),
					eq(assets.assetType, "screenshot"),
				),
			);

		for (const s of shots) {
			expect(s.deviceType).toBe("phone"); // GP device key the panel filters on
			expect(s.url?.startsWith("https://placehold.co/")).toBe(true);
			expect(["en-US", "pl-PL", "de-DE"]).toContain(s.language);
		}
	});

	it("creates an iOS App Store demo store with a fully populated Lumina iOS app", async () => {
		expect(result.iosStoreId).toBeTruthy();
		expect(result.luminaIosId).toBeTruthy();

		const [iosStore] = await db
			.select()
			.from(stores)
			.where(eq(stores.id, result.iosStoreId as string))
			.limit(1);
		expect(iosStore?.type).toBe("app_store");
		expect(iosStore?.status).toBe("connected");
		expect(iosStore?.credentials).toBeTruthy(); // mock credentials attached

		const iosStoreApps = await db
			.select({ bundleId: apps.bundleId, platform: apps.platform })
			.from(apps)
			.where(eq(apps.storeId, result.iosStoreId as string));
		expect(iosStoreApps).toHaveLength(3);
		for (const a of iosStoreApps) {
			expect(a.platform).toBe("ios");
		}
		expect(iosStoreApps.map((a) => a.bundleId).sort()).toEqual([
			"com.aura.sleep",
			"com.lumina.habits",
			"com.pulse.workout",
		]);

		const [iosApp] = await db
			.select()
			.from(apps)
			.where(eq(apps.id, result.luminaIosId as string))
			.limit(1);
		expect(iosApp?.platform).toBe("ios");
		expect(iosApp?.bundleId).toBe("com.lumina.habits");

		const iosListings = await db
			.select({ id: listings.id })
			.from(listings)
			.where(eq(listings.appId, result.luminaIosId as string));
		expect(iosListings).toHaveLength(4); // 2 languages × (remote + draft)

		const iosHistory = await db
			.select({ id: listingHistory.id })
			.from(listingHistory)
			.where(eq(listingHistory.appId, result.luminaIosId as string));
		expect(iosHistory).toHaveLength(5);

		const iosReviews = await db
			.select({ storeType: reviews.storeType })
			.from(reviews)
			.where(eq(reviews.appId, result.luminaIosId as string));
		expect(iosReviews).toHaveLength(4);
		for (const r of iosReviews) {
			expect(r.storeType).toBe("app_store");
		}

		const iosShots = await db
			.select()
			.from(assets)
			.where(
				and(
					eq(assets.appId, result.luminaIosId as string),
					eq(assets.assetType, "screenshot"),
				),
			);
		expect(iosShots).toHaveLength(8); // 5 en-US + 3 pl-PL
		for (const s of iosShots) {
			expect(s.deviceType).toBe("APP_IPHONE_67");
		}

		const iosVersions = await db
			.select()
			.from(appVersions)
			.where(eq(appVersions.appId, result.luminaIosId as string));
		expect(iosVersions).toHaveLength(1);
		expect(iosVersions[0].state).toBe("PREPARE_FOR_SUBMISSION");
	});

	it("populates the Aura and Pulse iOS apps with listings, reviews, screenshots and versions", async () => {
		for (const appId of [
			result.auraIosId as string,
			result.pulseIosId as string,
		]) {
			expect(appId).toBeTruthy();

			const [iosApp] = await db
				.select()
				.from(apps)
				.where(eq(apps.id, appId))
				.limit(1);
			expect(iosApp?.platform).toBe("ios");
			expect(iosApp?.storeId).toBe(result.iosStoreId as string);

			const listingRows = await db
				.select({ id: listings.id })
				.from(listings)
				.where(eq(listings.appId, appId));
			expect(listingRows).toHaveLength(4); // 2 languages × (remote + draft)

			const reviewRows = await db
				.select({ storeType: reviews.storeType })
				.from(reviews)
				.where(eq(reviews.appId, appId));
			expect(reviewRows).toHaveLength(4);
			for (const r of reviewRows) {
				expect(r.storeType).toBe("app_store");
			}

			const shotRows = await db
				.select()
				.from(assets)
				.where(
					and(eq(assets.appId, appId), eq(assets.assetType, "screenshot")),
				);
			expect(shotRows).toHaveLength(8); // 5 en-US + 3 pl-PL
			for (const s of shotRows) {
				expect(s.deviceType).toBe("APP_IPHONE_67");
			}

			const versionRows = await db
				.select()
				.from(appVersions)
				.where(eq(appVersions.appId, appId));
			expect(versionRows).toHaveLength(1);
			expect(versionRows[0].state).toBe("PREPARE_FOR_SUBMISSION");
		}
	});

	it("groups the Android + iOS Lumina apps with a shared ASO profile", async () => {
		expect(result.groupId).toBeTruthy();

		const [group] = await db
			.select()
			.from(appGroups)
			.where(eq(appGroups.id, result.groupId as string))
			.limit(1);
		expect(group?.name).toBe(TEST_CFG.groupName);
		expect(group?.useSharedProfile).toBe(true);
		expect(group?.workspaceId).toBe(result.workspaceId);

		const members = await db
			.select({ appId: appGroupMembers.appId })
			.from(appGroupMembers)
			.where(eq(appGroupMembers.groupId, result.groupId as string));
		const memberIds = members.map((m) => m.appId).sort();
		expect(memberIds).toEqual(
			[result.luminaId as string, result.luminaIosId as string].sort(),
		);

		const [groupProfile] = await db
			.select()
			.from(groupAsoProfiles)
			.where(eq(groupAsoProfiles.groupId, result.groupId as string))
			.limit(1);
		expect(groupProfile).toBeDefined();
		expect(groupProfile.oneLiner).toBeTruthy();
	});

	it("groups the Android + iOS Aura apps into a second group and leaves Pulse ungrouped", async () => {
		expect(result.auraGroupId).toBeTruthy();
		expect(result.auraGroupId).not.toBe(result.groupId);

		const [group] = await db
			.select()
			.from(appGroups)
			.where(eq(appGroups.id, result.auraGroupId as string))
			.limit(1);
		expect(group?.name).toBe(TEST_CFG.auraGroupName);
		expect(group?.useSharedProfile).toBe(true);
		expect(group?.workspaceId).toBe(result.workspaceId);

		const members = await db
			.select({ appId: appGroupMembers.appId })
			.from(appGroupMembers)
			.where(eq(appGroupMembers.groupId, result.auraGroupId as string));
		const memberIds = members.map((m) => m.appId).sort();
		expect(memberIds).toEqual(
			[result.auraId as string, result.auraIosId as string].sort(),
		);

		const [groupProfile] = await db
			.select()
			.from(groupAsoProfiles)
			.where(eq(groupAsoProfiles.groupId, result.auraGroupId as string))
			.limit(1);
		expect(groupProfile).toBeDefined();
		expect(groupProfile.oneLiner).toBeTruthy();

		// Pulse stays outside any group (shows ungrouped apps in the panel).
		const pulseMemberships = await db
			.select({ id: appGroupMembers.id })
			.from(appGroupMembers)
			.where(eq(appGroupMembers.appId, result.pulseId as string));
		expect(pulseMemberships).toHaveLength(0);

		const pulseIosMemberships = await db
			.select({ id: appGroupMembers.id })
			.from(appGroupMembers)
			.where(eq(appGroupMembers.appId, result.pulseIosId as string));
		expect(pulseIosMemberships).toHaveLength(0);
	});

	it("is idempotent — a second run creates no duplicate data", async () => {
		const second = await seedDemo(TEST_CFG);
		expect(second.created).toBe(false);
		expect(second.storeId).toBe(result.storeId);
		expect(second.iosStoreId).toBe(result.iosStoreId);
		expect(second.groupId).toBe(result.groupId);
		expect(second.auraGroupId).toBe(result.auraGroupId);
		expect(second.luminaIosId).toBe(result.luminaIosId);
		expect(second.auraIosId).toBe(result.auraIosId);
		expect(second.pulseId).toBe(result.pulseId);
		expect(second.pulseIosId).toBe(result.pulseIosId);

		const iosApps = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.storeId, result.iosStoreId as string));
		expect(iosApps).toHaveLength(3);

		for (const groupId of [
			result.groupId as string,
			result.auraGroupId as string,
		]) {
			const members = await db
				.select({ id: appGroupMembers.id })
				.from(appGroupMembers)
				.where(eq(appGroupMembers.groupId, groupId));
			expect(members).toHaveLength(2);
		}

		const appRows = await db
			.select({ id: apps.id })
			.from(apps)
			.where(eq(apps.storeId, result.storeId as string));
		expect(appRows).toHaveLength(3);

		const listingRows = await db
			.select({ id: listings.id })
			.from(listings)
			.where(eq(listings.appId, result.luminaId as string));
		expect(listingRows).toHaveLength(6);

		const reviewRows = await db
			.select({ id: reviews.id })
			.from(reviews)
			.where(eq(reviews.appId, result.luminaId as string));
		expect(reviewRows).toHaveLength(6);

		const pulseListings = await db
			.select({ id: listings.id })
			.from(listings)
			.where(eq(listings.appId, result.pulseId as string));
		expect(pulseListings).toHaveLength(4);

		const pulseReviews = await db
			.select({ id: reviews.id })
			.from(reviews)
			.where(eq(reviews.appId, result.pulseId as string));
		expect(pulseReviews).toHaveLength(5);
	});

	it("is additive — leaves other workspaces untouched", async () => {
		expect(await storeCount(getTestWorkspaceId())).toBe(baselineA);
		expect(await storeCount(getTestWorkspaceIdB())).toBe(baselineB);
		expect(result.workspaceId).not.toBe(getTestWorkspaceId());
		expect(result.workspaceId).not.toBe(getTestWorkspaceIdB());
	});

	it("exposes the default demo identity used by the CLI seed", () => {
		expect(DEMO.email).toBe("demo@appboard.dev");
		expect(DEMO.workspaceName).toBe("AppBoard Demo");
	});
});
