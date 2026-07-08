/**
 * Real Google Play API integration tests.
 *
 * These tests run against the REAL Google Play Developer API — they test
 * credential validation, app fetching, listings, and (if a payments profile
 * is registered) IAP and subscription CRUD.
 *
 * Requires .env variables:
 *   GP_SERVICE_ACCOUNT_JSON (base64 or raw JSON of service account)
 *   GP_TEST_PACKAGE_NAME (e.g. com.example.app)
 *
 * To run:
 *   GP_INTEGRATION=1 bun test src/test/real-gp-integration.test.ts
 *
 * Note: IAP/Subscription CRUD requires a payments profile registered in the
 * Google Play Console. If not set up, those tests will be skipped gracefully.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { GooglePlayProvider } from "@/providers/google-play/index";
import type { GooglePlayCredentials } from "@/providers/google-play/types";

const SHOULD_RUN = process.env.GP_INTEGRATION === "1";

function getCredentials(): {
	credentials: GooglePlayCredentials;
	packageName: string;
} | null {
	const raw = process.env.GP_SERVICE_ACCOUNT_JSON;
	const packageName = process.env.GP_TEST_PACKAGE_NAME;

	if (!raw || !packageName) return null;

	try {
		let json: string;
		try {
			json = atob(raw);
		} catch {
			json = raw;
		}
		const parsed = JSON.parse(json);
		return {
			credentials: {
				client_email: parsed.client_email,
				package_names: [packageName],
				private_key: parsed.private_key,
				private_key_id: parsed.private_key_id,
				project_id: parsed.project_id,
				type: parsed.type,
			},
			packageName,
		};
	} catch {
		return null;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isPaymentsProfileError(err: unknown): boolean {
	const msg = (err as Error).message ?? "";
	return msg.includes("payments profile");
}

describe.skipIf(!SHOULD_RUN)(
	"Real Google Play API Integration",
	() => {
		const config = getCredentials();
		const provider = config
			? new GooglePlayProvider(config.credentials)
			: (null as unknown as GooglePlayProvider);
		const appId = config?.packageName ?? "";

		const TEST_PREFIX = `test_${Date.now()}_`;

		const createdIapIds: string[] = [];
		const createdSubIds: string[] = [];
		let hasPaymentsProfile: boolean | null = null;

		beforeAll(() => {
			expect(config).not.toBeNull();
		});

		afterAll(async () => {
			if (!config) return;
			for (const iapId of createdIapIds) {
				try {
					await provider.deleteInAppPurchase(appId, iapId);
				} catch {
					/* already deleted */
				}
				await sleep(200);
			}
			for (const subId of createdSubIds) {
				try {
					await provider.deleteSubscription(appId, subId);
				} catch {
					/* already deleted */
				}
				await sleep(200);
			}
		});

		// ── Validate credentials ──────────────────────────────────────

		it("should validate credentials", async () => {
			const valid = await provider.validateCredentials();
			expect(valid).toBe(true);
		});

		// ── Fetch existing data ───────────────────────────────────────

		it("should fetch apps", async () => {
			const apps = await provider.fetchApps();
			expect(apps.length).toBeGreaterThan(0);

			const testApp = apps.find((a) => a.bundleId === appId);
			expect(testApp).toBeDefined();
			expect(testApp!.platform).toBe("android");
		});

		it("should fetch listings", async () => {
			const listings = await provider.fetchListings(appId);
			expect(listings.length).toBeGreaterThan(0);

			const enListing = listings.find((l) => l.language === "en-US");
			expect(enListing).toBeDefined();
			expect(enListing!.title).toBeTruthy();
		});

		it("should fetch existing in-app purchases", async () => {
			const iaps = await provider.fetchInAppPurchases(appId);
			expect(Array.isArray(iaps)).toBe(true);
		});

		it("should fetch existing subscription groups", async () => {
			const groups = await provider.fetchSubscriptionGroups(appId);
			expect(Array.isArray(groups)).toBe(true);
		});

		it("should fetch reviews", async () => {
			const reviews = await provider.fetchReviews(appId);
			expect(Array.isArray(reviews)).toBe(true);
		});

		// ── Probe payments profile ────────────────────────────────────

		it("should probe payments profile availability", async () => {
			try {
				const iap = await provider.createInAppPurchase(appId, {
					localizations: [
						{
							description: "Probe product",
							language: "en-US",
							name: "Probe",
						},
					],
					name: `${TEST_PREFIX}probe`,
					productId: `${TEST_PREFIX}probe`,
					productType: "consumable",
				});
				createdIapIds.push(iap.externalId);
				hasPaymentsProfile = true;
			} catch (err) {
				if (isPaymentsProfileError(err)) {
					hasPaymentsProfile = false;
				} else {
					throw err;
				}
			}

			// Either way, the probe should have run without unexpected errors
			expect(hasPaymentsProfile).not.toBeNull();
		});

		// ── IAP CRUD (requires payments profile) ──────────────────────

		it("should create consumable IAP", async () => {
			if (!hasPaymentsProfile) return;

			const productId = `${TEST_PREFIX}coins_100`;
			const iap = await provider.createInAppPurchase(appId, {
				localizations: [
					{
						description: "100 test coins for testing",
						language: "en-US",
						name: "100 Test Coins",
					},
				],
				name: `${TEST_PREFIX}Coins`,
				productId,
				productType: "consumable",
			});
			createdIapIds.push(iap.externalId);

			expect(iap.externalId).toBeTruthy();
			expect(iap.productId).toBe(productId);
			await sleep(500);
		});

		it("should update and verify IAP", async () => {
			if (!hasPaymentsProfile || createdIapIds.length < 2) return;

			const iapId = createdIapIds[1]; // coins_100 (probe is [0])
			await provider.updateInAppPurchase(appId, iapId, {
				localizations: [
					{
						description: "200 test coins updated",
						language: "en-US",
						name: "200 Test Coins",
					},
				],
				name: "200 Test Coins",
			});

			const iaps = await provider.fetchInAppPurchases(appId);
			const updated = iaps.find((p) => p.externalId === iapId);
			expect(updated).toBeDefined();
		});

		it("should delete all created IAPs", async () => {
			if (!hasPaymentsProfile || createdIapIds.length === 0) return;

			for (const iapId of [...createdIapIds]) {
				await provider.deleteInAppPurchase(appId, iapId);
				await sleep(300);
			}
			createdIapIds.length = 0;

			const iaps = await provider.fetchInAppPurchases(appId);
			const remaining = iaps.filter((p) => p.productId.startsWith(TEST_PREFIX));
			expect(remaining).toHaveLength(0);
		}, 15_000);

		// ── Subscription CRUD (requires payments profile) ─────────────

		it("should create and delete subscription", async () => {
			if (!hasPaymentsProfile) return;

			const productId = `${TEST_PREFIX}monthly`;
			const sub = await provider.createSubscription(appId, `${appId}-group`, {
				duration: "P1M",
				localizations: [
					{
						description: "Monthly test subscription",
						language: "en-US",
						name: "Test Monthly",
					},
				],
				name: `${TEST_PREFIX}Monthly`,
				productId,
			});
			createdSubIds.push(sub.externalId);

			expect(sub.externalId).toBeTruthy();
			expect(sub.productType).toBe("auto_renewable");

			// Cleanup
			await provider.deleteSubscription(appId, sub.externalId);
			createdSubIds.length = 0;
		});
	},
	{ timeout: 120_000 },
);
