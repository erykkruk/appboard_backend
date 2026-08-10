import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import {
	ALTERNATIVE_STORE_TYPES,
	isAlternativeStoreType,
	PRIMARY_STORE_TYPES,
	STORE_TYPE_LABELS,
	STORE_TYPE_PLATFORM,
	STORE_TYPES,
} from "@/config/const";
import {
	getCapabilityDefinitions,
	STORE_SETUP_INFO,
} from "@/config/store-capabilities";
import { storesController } from "@/modules/stores";
import { createProvider } from "@/providers";
import { AmazonAppstoreProvider } from "@/providers/amazon-appstore";
import { HuaweiAppGalleryProvider } from "@/providers/huawei-appgallery";
import { SamsungGalaxyProvider } from "@/providers/samsung-galaxy";
import { encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { stores } from "@/utils/db/schema";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
} from "./setup";

const app = new Elysia()
	.use(authGuard)
	.group("/api", (a) => a.use(storesController));

/** Capabilities each provider genuinely implements against the live store API. */
const WIRED_CAPABILITIES: Record<string, string[]> = {
	amazon_appstore: ["listings", "assets", "publishing"],
	huawei_appgallery: ["listings", "publishing"],
	onestore: [],
	rustore: [],
	samsung_galaxy: ["listings", "assets", "publishing"],
	xiaomi_getapps: [],
};

describe("multi-store store types", () => {
	it("keeps the two primary stores and adds the alternatives", () => {
		expect(PRIMARY_STORE_TYPES).toEqual(["google_play", "app_store"]);
		expect(STORE_TYPES).toContain("huawei_appgallery");
		expect(STORE_TYPES).toContain("amazon_appstore");
		expect(STORE_TYPES.length).toBe(
			PRIMARY_STORE_TYPES.length + ALTERNATIVE_STORE_TYPES.length,
		);
	});

	it("classifies alternative vs primary store types", () => {
		expect(isAlternativeStoreType("huawei_appgallery")).toBe(true);
		expect(isAlternativeStoreType("rustore")).toBe(true);
		expect(isAlternativeStoreType("google_play")).toBe(false);
		expect(isAlternativeStoreType("app_store")).toBe(false);
	});

	it("has a label and platform for every store type", () => {
		for (const type of STORE_TYPES) {
			expect(STORE_TYPE_LABELS[type]).toBeTruthy();
			expect(["android", "ios"]).toContain(STORE_TYPE_PLATFORM[type]);
		}
		// Every alternative store is Android today.
		for (const type of ALTERNATIVE_STORE_TYPES) {
			expect(STORE_TYPE_PLATFORM[type]).toBe("android");
		}
	});
});

describe("alternative store providers", () => {
	it("routes each alternative store to its real provider", () => {
		expect(
			createProvider("huawei_appgallery", { clientId: "a", clientSecret: "b" }),
		).toBeInstanceOf(HuaweiAppGalleryProvider);
		expect(
			createProvider("samsung_galaxy", {
				privateKey: "k",
				serviceAccountId: "s",
			}),
		).toBeInstanceOf(SamsungGalaxyProvider);
		expect(
			createProvider("amazon_appstore", { clientId: "a", clientSecret: "b" }),
		).toBeInstanceOf(AmazonAppstoreProvider);
	});
});

describe("alternative store capabilities are honest", () => {
	it("marks exactly the implemented capabilities as wired", () => {
		for (const type of ALTERNATIVE_STORE_TYPES) {
			const wired = getCapabilityDefinitions(type)
				.filter((definition) => definition.wired)
				.map((definition) => definition.id);

			expect(wired.sort()).toEqual([...WIRED_CAPABILITIES[type]].sort());
		}
	});

	it("treats every non-wired capability as console-only", () => {
		for (const type of ALTERNATIVE_STORE_TYPES) {
			for (const definition of getCapabilityDefinitions(type)) {
				expect(definition.consoleOnly).toBe(!definition.wired);
			}
		}
	});

	it("describes every capability for every alternative store", () => {
		for (const type of ALTERNATIVE_STORE_TYPES) {
			const definitions = getCapabilityDefinitions(type);
			expect(definitions.length).toBe(8);
			for (const definition of definitions) {
				expect(definition.description.length).toBeGreaterThan(0);
				expect(definition.name.length).toBeGreaterThan(0);
			}
		}
	});

	it("gives each store real console setup instructions, not a placeholder", () => {
		for (const type of ALTERNATIVE_STORE_TYPES) {
			const note = STORE_SETUP_INFO[type].baseNote;
			expect(note).not.toContain("coming soon");
			expect(note.length).toBeGreaterThan(60);
		}

		expect(STORE_SETUP_INFO.huawei_appgallery.baseNote).toContain(
			"AppGallery Connect",
		);
		expect(STORE_SETUP_INFO.samsung_galaxy.baseNote).toContain("Seller Portal");
		expect(STORE_SETUP_INFO.amazon_appstore.baseNote).toContain(
			"Security Profiles",
		);
		expect(STORE_SETUP_INFO.rustore.baseNote).toContain("API keys");
	});
});

describe("alternative store workspace isolation", () => {
	const createdStoreIds: string[] = [];

	afterAll(async () => {
		await cleanupStores(createdStoreIds);
	});

	it("hides another workspace's alternative store connection", async () => {
		const [store] = await db
			.insert(stores)
			.values({
				credentials: encrypt(JSON.stringify({ mock: true })),
				name: "Huawei A",
				status: "connected",
				type: "huawei_appgallery",
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		createdStoreIds.push(store.id);

		const ownerRes = await app.handle(
			authRequest("http://localhost/api/stores"),
		);
		const owned = (await ownerRes.json()) as { stores: Array<{ id: string }> };
		expect(owned.stores.some((entry) => entry.id === store.id)).toBe(true);

		const otherRes = await app.handle(
			authRequestB("http://localhost/api/stores"),
		);
		const visible = (await otherRes.json()) as {
			stores: Array<{ id: string }>;
		};
		expect(visible.stores.some((entry) => entry.id === store.id)).toBe(false);
	});
});
