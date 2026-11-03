import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import type { ApiResource } from "node-app-store-connect-api";
import { PublishingService } from "@/modules/publishing/publishing.service";
import { AppStoreProvider, iosListingVersions } from "@/providers/app-store";
import * as ascClient from "@/providers/app-store/client";
import { cleanupStores, getTestWorkspaceId } from "@/test/setup";
import { encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apps, appVersions, stores } from "@/utils/db/schema";

const APP_ID = "1234567890";
const LOCALE = "en-US";

function version(
	id: string,
	platform: string | undefined,
	versionString: string,
): ApiResource {
	return {
		attributes: {
			appStoreState: "PREPARE_FOR_SUBMISSION",
			...(platform ? { platform } : {}),
			versionString,
		},
		id,
		type: "appStoreVersions",
	} as ApiResource;
}

const IOS = version("ver-ios", "IOS", "2.4.0");
const TV = version("ver-tv", "TV_OS", "1.1.0");

type AscClient = Awaited<ReturnType<typeof ascClient.createAppStoreClient>>;

/**
 * Fake App Store Connect client: serves the given versions and one en-US
 * localization per resource, and records every read path and update.
 */
function fakeAsc(versions: ApiResource[]) {
	const reads: string[] = [];
	const updates: string[] = [];
	const loc = (id: string) => ({
		attributes: { locale: LOCALE },
		id,
		type: "localizations",
	});
	const client = {
		readAll: async (path: string) => {
			reads.push(path);
			if (path === `apps/${APP_ID}/appStoreVersions`) return { data: versions };
			if (path === `apps/${APP_ID}/appInfos`) {
				return { data: [{ attributes: {}, id: "info-1", type: "appInfos" }] };
			}
			const versionLocs = path.match(
				/^appStoreVersions\/(.+)\/appStoreVersionLocalizations$/,
			);
			if (versionLocs) return { data: [loc(`loc-${versionLocs[1]}`)] };
			if (path.endsWith("/appInfoLocalizations")) {
				return { data: [loc("info-loc-1")] };
			}
			return { data: [] };
		},
		update: async (resource: { id: string }) => {
			updates.push(resource.id);
			return resource;
		},
	};
	spyOn(ascClient, "createAppStoreClient").mockResolvedValue(
		client as unknown as AscClient,
	);
	return { reads, updates };
}

function provider() {
	return new AppStoreProvider({
		issuerId: "issuer",
		keyId: "key",
		privateKey: "not-used-by-the-fake",
	});
}

afterEach(() => {
	(
		ascClient.createAppStoreClient as unknown as { mockRestore?: () => void }
	).mockRestore?.();
});

describe("iosListingVersions", () => {
	it("keeps only IOS versions when the record also ships on Apple TV", () => {
		expect(iosListingVersions([IOS, TV])).toEqual([IOS]);
		expect(iosListingVersions([TV, IOS])).toEqual([IOS]);
	});

	it("leaves single-platform lists unchanged", () => {
		expect(iosListingVersions([IOS])).toEqual([IOS]);
		expect(iosListingVersions([TV])).toEqual([TV]);
		const noPlatform = [
			version("a", undefined, "1.0"),
			version("b", undefined, "0.9"),
		];
		expect(iosListingVersions(noPlatform)).toEqual(noPlatform);
		expect(iosListingVersions([])).toEqual([]);
	});
});

describe("AppStoreProvider picks the iOS version over tvOS", () => {
	for (const [label, order] of [
		["IOS first", [IOS, TV]],
		["TV_OS first", [TV, IOS]],
	] as const) {
		it(`getLatestVersion (${label})`, async () => {
			fakeAsc([...order]);
			const latest = await provider().getLatestVersion(APP_ID);
			expect(latest?.versionString).toBe("2.4.0");
		});

		it(`fetchListings reads the iOS version localizations (${label})`, async () => {
			const { reads } = fakeAsc([...order]);
			await provider().fetchListings(APP_ID);
			expect(reads).toContain(
				"appStoreVersions/ver-ios/appStoreVersionLocalizations",
			);
			expect(reads).not.toContain(
				"appStoreVersions/ver-tv/appStoreVersionLocalizations",
			);
		});

		it(`fetchAssets reads the iOS version (${label})`, async () => {
			const { reads } = fakeAsc([...order]);
			await provider().fetchAssets(APP_ID, LOCALE);
			expect(reads).toContain(
				"appStoreVersions/ver-ios/appStoreVersionLocalizations",
			);
			expect(reads).not.toContain(
				"appStoreVersions/ver-tv/appStoreVersionLocalizations",
			);
		});

		it(`updateListing edits the editable iOS version (${label})`, async () => {
			const { updates } = fakeAsc([...order]);
			await provider().updateListing(APP_ID, LOCALE, {
				keywords: "party,quiz",
			});
			expect(updates).toContain("loc-ver-ios");
			expect(updates).not.toContain("loc-ver-tv");
		});
	}

	it("still uses the tvOS version of a tvOS-only record", async () => {
		fakeAsc([TV]);
		const latest = await provider().getLatestVersion(APP_ID);
		expect(latest?.versionString).toBe("1.1.0");
	});
});

describe("PublishingService.syncVersions skips tvOS versions", () => {
	const storeIds: string[] = [];

	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	async function seedIosApp(label: string) {
		const [store] = await db
			.insert(stores)
			.values({
				credentials: encrypt(
					JSON.stringify({ issuerId: "i", keyId: "k", privateKey: "p" }),
				),
				name: `ASC platform test (${label})`,
				status: "connected",
				type: "app_store",
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		storeIds.push(store.id);
		const [app] = await db
			.insert(apps)
			.values({
				bundleId: "com.test.tv-platform",
				externalId: APP_ID,
				name: "Platform Test App",
				platform: "ios",
				storeId: store.id,
			})
			.returning();
		return app.id;
	}

	for (const [label, order] of [
		["IOS first", [IOS, TV]],
		["TV_OS first", [TV, IOS]],
	] as const) {
		it(`stores only the iOS version (${label})`, async () => {
			const appId = await seedIosApp(label);
			fakeAsc([...order]);

			const result = await PublishingService.syncVersions(appId);

			expect(result).toEqual({ source: "live", synced: 1 });
			const rows = await db
				.select({ externalId: appVersions.externalId })
				.from(appVersions)
				.where(eq(appVersions.appId, appId));
			expect(rows.map((r) => r.externalId)).toEqual(["ver-ios"]);
		});
	}
});
