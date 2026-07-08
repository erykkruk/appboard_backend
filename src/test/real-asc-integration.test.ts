/**
 * Real App Store Connect API integration tests.
 *
 * These tests run against the REAL ASC API — they create and delete
 * subscription groups, subscriptions (all 6 durations), and IAPs.
 *
 * Requires .env variables:
 *   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, ASC_TEST_APP_ID
 *
 * To run:
 *   ASC_INTEGRATION=1 bun test src/test/real-asc-integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AppStoreProvider } from "@/providers/app-store/index";

const SHOULD_RUN = process.env.ASC_INTEGRATION === "1";

function getCredentials() {
	const keyId = process.env.ASC_KEY_ID;
	const issuerId = process.env.ASC_ISSUER_ID;
	const rawKey = process.env.ASC_PRIVATE_KEY;
	const testAppId = process.env.ASC_TEST_APP_ID;

	if (!keyId || !issuerId || !rawKey || !testAppId) return null;

	// Support \n in .env for multiline private key
	const privateKey = rawKey.replace(/\\n/g, "\n");

	return { issuerId, keyId, privateKey, testAppId };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!SHOULD_RUN)(
	"Real ASC API Integration",
	() => {
		const creds = getCredentials();
		const provider = creds
			? new AppStoreProvider(creds)
			: (null as unknown as AppStoreProvider);
		const appId = creds?.testAppId ?? "";

		const TEST_PREFIX = `test_${Date.now()}_`;

		let groupExternalId: string;
		const createdSubIds: string[] = [];
		const createdIapIds: string[] = [];

		beforeAll(() => {
			expect(creds).not.toBeNull();
		});

		afterAll(async () => {
			if (!creds) return;
			// Cleanup everything we created, in case any test failed
			for (const subId of createdSubIds) {
				try {
					await provider.deleteSubscription(appId, subId);
				} catch {
					/* already deleted */
				}
				await sleep(200);
			}
			for (const iapId of createdIapIds) {
				try {
					await provider.deleteInAppPurchase(appId, iapId);
				} catch {
					/* already deleted */
				}
				await sleep(200);
			}
			if (groupExternalId) {
				try {
					const { createAppStoreClient } = await import(
						"@/providers/app-store/client"
					);
					const client = await createAppStoreClient(creds);
					await client.remove({
						id: groupExternalId,
						type: "subscriptionGroups",
					});
				} catch {
					/* already deleted */
				}
			}
		});

		it("should create a subscription group", async () => {
			const group = await provider.createSubscriptionGroup(
				appId,
				`${TEST_PREFIX}Premium`,
			);
			groupExternalId = group.externalId;

			expect(group.externalId).toBeTruthy();
			expect(group.name).toBe(`${TEST_PREFIX}Premium`);
		});

		const durations = [
			{ iso: "P1W", label: "Weekly" },
			{ iso: "P1M", label: "Monthly" },
			{ iso: "P2M", label: "Bi-Monthly" },
			{ iso: "P3M", label: "Quarterly" },
			{ iso: "P6M", label: "Semi-Annual" },
			{ iso: "P1Y", label: "Annual" },
		];

		for (const d of durations) {
			it(`should create subscription with duration ${d.iso} (${d.label})`, async () => {
				const productId = `${TEST_PREFIX}${d.label.toLowerCase().replace("-", "_")}`;
				const sub = await provider.createSubscription(appId, groupExternalId, {
					duration: d.iso,
					localizations: [
						{
							description: `Test ${d.label} subscription`,
							language: "en-US",
							name: `Test ${d.label}`,
						},
					],
					name: `${TEST_PREFIX}${d.label}`,
					productId,
				});
				createdSubIds.push(sub.externalId);

				expect(sub.externalId).toBeTruthy();
				expect(sub.productId).toBe(productId);
				expect(sub.duration).toBe(d.iso);
				await sleep(500);
			});
		}

		it("should verify all 6 subscriptions in the group", async () => {
			const groups = await provider.fetchSubscriptionGroups(appId);
			const group = groups.find((g) => g.externalId === groupExternalId);

			expect(group).toBeDefined();
			expect(group!.subscriptions).toHaveLength(6);

			for (const d of durations) {
				const sub = group!.subscriptions.find((s) => s.duration === d.iso);
				expect(sub).toBeDefined();
			}
		});

		it("should rename subscription group", async () => {
			await provider.updateSubscriptionGroup(
				appId,
				groupExternalId,
				`${TEST_PREFIX}Premium_Renamed`,
			);

			const groups = await provider.fetchSubscriptionGroups(appId);
			const group = groups.find((g) => g.externalId === groupExternalId);
			expect(group?.name).toBe(`${TEST_PREFIX}Premium_Renamed`);
		});

		it("should create consumable IAP", async () => {
			const iap = await provider.createInAppPurchase(appId, {
				localizations: [
					{
						description: "100 test coins",
						language: "en-US",
						name: "100 Coins",
					},
				],
				name: `${TEST_PREFIX}Coins`,
				productId: `${TEST_PREFIX}coins_100`,
				productType: "consumable",
			});
			createdIapIds.push(iap.externalId);

			expect(iap.externalId).toBeTruthy();
			expect(iap.productType).toBe("consumable");
			await sleep(500);
		});

		it("should create non-consumable IAP", async () => {
			const iap = await provider.createInAppPurchase(appId, {
				localizations: [
					{
						description: "Remove all ads",
						language: "en-US",
						name: "Remove Ads",
					},
				],
				name: `${TEST_PREFIX}RemoveAds`,
				productId: `${TEST_PREFIX}remove_ads`,
				productType: "non_consumable",
			});
			createdIapIds.push(iap.externalId);

			expect(iap.externalId).toBeTruthy();
			expect(iap.productType).toBe("non_consumable");
		});

		it("should verify IAPs via fetchInAppPurchases", async () => {
			const iaps = await provider.fetchInAppPurchases(appId);
			const testIaps = iaps.filter((p) => p.productId.startsWith(TEST_PREFIX));

			expect(testIaps).toHaveLength(2);

			const consumable = testIaps.find((p) => p.productType === "consumable");
			const nonConsumable = testIaps.find(
				(p) => p.productType === "non_consumable",
			);

			expect(consumable).toBeDefined();
			expect(nonConsumable).toBeDefined();
		});

		it("should delete all subscriptions and IAPs, then delete group", async () => {
			// Delete subscriptions
			for (const subId of [...createdSubIds]) {
				await provider.deleteSubscription(appId, subId);
				await sleep(300);
			}
			createdSubIds.length = 0;

			// Verify subscriptions deleted
			const groups = await provider.fetchSubscriptionGroups(appId);
			const group = groups.find((g) => g.externalId === groupExternalId);
			expect(group?.subscriptions ?? []).toHaveLength(0);

			// Delete IAPs
			for (const iapId of [...createdIapIds]) {
				await provider.deleteInAppPurchase(appId, iapId);
				await sleep(300);
			}
			createdIapIds.length = 0;

			// Verify IAPs deleted
			const iaps = await provider.fetchInAppPurchases(appId);
			const remainingIaps = iaps.filter((p) =>
				p.productId.startsWith(TEST_PREFIX),
			);
			expect(remainingIaps).toHaveLength(0);

			// Delete subscription group (must be empty)
			const { createAppStoreClient } = await import(
				"@/providers/app-store/client"
			);
			const client = await createAppStoreClient(creds!);
			await client.remove({
				id: groupExternalId,
				type: "subscriptionGroups",
			});

			// Verify group deleted
			const finalGroups = await provider.fetchSubscriptionGroups(appId);
			const remainingGroups = finalGroups.filter(
				(g) => g.externalId === groupExternalId,
			);
			expect(remainingGroups).toHaveLength(0);

			groupExternalId = ""; // Prevent afterAll double-delete
		}, 30_000);
	},
	{ timeout: 120_000 },
);
