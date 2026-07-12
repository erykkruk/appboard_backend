import { describe, expect, it } from "bun:test";
import {
	ALTERNATIVE_STORE_TYPES,
	isAlternativeStoreType,
	PRIMARY_STORE_TYPES,
	STORE_TYPE_LABELS,
	STORE_TYPE_PLATFORM,
	STORE_TYPES,
} from "@/config/const";
import { createProvider } from "@/providers";
import { MockStoreProvider } from "@/providers/mock";

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

describe("MockStoreProvider (alternative store stub)", () => {
	it("createProvider routes alternative stores to the mock provider", () => {
		expect(createProvider("huawei_appgallery", {})).toBeInstanceOf(
			MockStoreProvider,
		);
		expect(createProvider("amazon_appstore", {})).toBeInstanceOf(
			MockStoreProvider,
		);
	});

	it("validates credentials and returns namespaced mock apps", async () => {
		const provider = new MockStoreProvider("huawei_appgallery", {});
		const validation = await provider.validateCredentials();
		expect(validation.valid).toBe(true);

		const apps = await provider.fetchApps();
		expect(apps.length).toBeGreaterThan(0);
		for (const app of apps) {
			expect(app.platform).toBe("android");
			expect(app.externalId.startsWith("huawei_appgallery:")).toBe(true);
		}
	});

	it("serves mock reviews and reports monetization as unsupported", async () => {
		const provider = new MockStoreProvider("amazon_appstore", {});
		const reviews = await provider.fetchReviews(
			"amazon_appstore:com.example.taskmaster",
		);
		expect(reviews.length).toBeGreaterThan(0);

		const monetization = await provider.checkMonetizationSupport("x");
		expect(monetization.supported).toBe(false);
	});
});
