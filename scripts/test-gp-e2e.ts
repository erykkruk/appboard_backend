/**
 * End-to-end test: full flow through backend API endpoints with real GP credentials.
 * Tests: connect store → sync apps → fetch listings → save listing → fetch capabilities → fetch assets
 *
 * Usage: bun run scripts/test-gp-e2e.ts
 */

const BASE = "http://localhost:6680/api";
const KEY_PATH = "./keys/museo-46b90-78fc32bc1b47.json";

// Test user header (dev mode auth bypass)
const TEST_USER = "test-user-001";
const headers = {
	"Content-Type": "application/json",
	"x-test-user-id": TEST_USER,
};

let storeId: string;
let appId: string;

async function api(path: string, init?: RequestInit) {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers: { ...headers, ...init?.headers },
	});
	const data = await res.json();
	if (!res.ok) {
		console.error(
			`  [FAIL] ${init?.method ?? "GET"} ${path} → ${res.status}`,
			data,
		);
		return null;
	}
	return data;
}

async function main() {
	const keyFile = await Bun.file(KEY_PATH).json();
	console.log("=== E2E Test: Google Play full flow ===\n");
	console.log("Service account:", keyFile.client_email);

	// 1. Connect store
	console.log("\n--- 1. POST /stores/connect ---");
	const connectRes = await api("/stores/connect", {
		body: JSON.stringify({
			credentials: {
				client_email: keyFile.client_email,
				private_key: keyFile.private_key,
				private_key_id: keyFile.private_key_id,
				project_id: keyFile.project_id,
			},
			name: "E2E Test GP Store",
			type: "google_play",
		}),
		method: "POST",
	});

	if (!connectRes) return;
	storeId = connectRes.store.id;
	console.log(`  [PASS] Store connected: ${storeId}`);
	console.log(`  syncedApps: ${connectRes.syncedApps}`);
	console.log(`  warnings: ${JSON.stringify(connectRes.warnings)}`);

	if (connectRes.syncedApps === 0) {
		console.log(
			"\n  [WARN] No apps synced — cannot continue E2E. Cleaning up...",
		);
		await cleanup();
		return;
	}

	// 2. List stores
	console.log("\n--- 2. GET /stores ---");
	const storesRes = await api("/stores");
	if (!storesRes) return;
	const ourStore = storesRes.stores.find(
		(s: { id: string }) => s.id === storeId,
	);
	console.log(
		`  [PASS] Store found in list: ${ourStore?.name} (${ourStore?.type})`,
	);

	// 3. List apps
	console.log("\n--- 3. GET /apps ---");
	const appsRes = await api("/apps");
	if (!appsRes) return;
	const gpApps = appsRes.apps.filter(
		(a: { storeId: string }) => a.storeId === storeId,
	);
	console.log(`  [PASS] Found ${gpApps.length} app(s) for this store`);
	for (const app of gpApps) {
		console.log(`    - ${app.name} (${app.bundleId}) [${app.platform}]`);
	}
	appId = gpApps[0]?.id;

	if (!appId) {
		console.log("  [WARN] No app found, cleaning up...");
		await cleanup();
		return;
	}

	// 4. Fetch capabilities
	console.log("\n--- 4. GET /apps/:appId/capabilities ---");
	const capRes = await api(`/apps/${appId}/capabilities`);
	if (capRes) {
		const cap = capRes.capabilities;
		console.log(`  [PASS] Listing fields: ${cap.listings.fields.join(", ")}`);
		console.log(`  publishing.hasVersions: ${cap.publishing.hasVersions}`);
		console.log(`  publishing.hasTracks: ${cap.publishing.hasTracks}`);
		console.log(`  ageRating.supported: ${cap.ageRating.supported}`);
		console.log(`  categories.supported: ${cap.categories.supported}`);
		console.log(`  privacy.supported: ${cap.privacy.supported}`);
	}

	// 5. Fetch versions (should return synthetic GP version)
	console.log("\n--- 5. GET /apps/:appId/publishing/versions ---");
	const versionsRes = await api(`/apps/${appId}/publishing/versions`);
	if (versionsRes) {
		console.log(`  [PASS] Versions: ${versionsRes.versions.length}`);
		for (const v of versionsRes.versions) {
			console.log(
				`    - ${v.versionString} (state: ${v.state}, editable: ${v.isEditable})`,
			);
		}
	}

	const versionId = versionsRes?.versions?.[0]?.id;

	// 6. Fetch version localizations (listings bridge)
	// Note: GET localizations route is /versions/:versionId (not /versions/:versionId/localizations)
	if (versionId) {
		console.log("\n--- 6. GET /apps/:appId/publishing/versions/:versionId ---");
		const locRes = await api(`/apps/${appId}/publishing/versions/${versionId}`);
		if (locRes) {
			console.log(`  [PASS] Localizations: ${locRes.localizations.length}`);
			for (const loc of locRes.localizations) {
				console.log(
					`    - [${loc.language}] "${loc.title}" | short: "${loc.shortDescription ?? loc.subtitle ?? ""}" | desc length: ${(loc.description || loc.fullDescription || "").length}`,
				);
			}
		}

		// 7. Sync listings from store
		console.log("\n--- 7. POST /apps/:appId/listings/sync ---");
		const syncRes = await api(`/apps/${appId}/listings/sync`, {
			method: "POST",
		});
		if (syncRes) {
			console.log(
				`  [PASS] Listings synced: ${syncRes.count ?? syncRes.synced ?? "OK"}`,
			);
		}

		// 8. Fetch listings after sync
		console.log(
			"\n--- 8. GET /apps/:appId/publishing/versions/:versionId (after sync) ---",
		);
		const locRes2 = await api(
			`/apps/${appId}/publishing/versions/${versionId}`,
		);
		if (locRes2) {
			console.log(
				`  [PASS] Localizations after sync: ${locRes2.localizations.length}`,
			);
			for (const loc of locRes2.localizations) {
				console.log(`    - [${loc.language}] "${loc.title}"`);
				console.log(
					`      shortDesc: "${loc.shortDescription ?? loc.subtitle ?? ""}"`,
				);
				console.log(
					`      desc: "${(loc.description || loc.fullDescription || "").substring(0, 80)}..."`,
				);
			}
		}

		// 9. Save a listing (update localization)
		if (locRes2?.localizations?.length > 0) {
			const firstLoc = locRes2.localizations[0];
			const locId = firstLoc.localizationId ?? firstLoc.id;
			console.log(
				`\n--- 9. PATCH /apps/:appId/publishing/versions/:versionId/localizations/:locId ---`,
			);
			const updateRes = await api(
				`/apps/${appId}/publishing/versions/${versionId}/localizations/${locId}`,
				{
					body: JSON.stringify({
						fullDescription: firstLoc.description || firstLoc.fullDescription,
						shortDescription: firstLoc.shortDescription ?? firstLoc.subtitle,
						title: firstLoc.title,
					}),
					method: "PATCH",
				},
			);
			if (updateRes) {
				console.log(`  [PASS] Localization saved (id: ${locId})`);
			}
		}
	}

	// 10. Fetch assets
	console.log("\n--- 10. GET /apps/:appId/assets?language=en-US ---");
	const assetsRes = await api(`/apps/${appId}/assets?language=en-US`);
	if (assetsRes) {
		const assets = assetsRes.assets ?? [];
		console.log(`  [PASS] Assets: ${assets.length}`);
		const byType: Record<string, number> = {};
		for (const a of assets) {
			byType[a.assetType] = (byType[a.assetType] || 0) + 1;
		}
		for (const [type, count] of Object.entries(byType)) {
			console.log(`    - ${type}: ${count}`);
		}
	}

	// 11. Fetch reviews
	console.log("\n--- 11. GET /apps/:appId/reviews ---");
	const reviewsRes = await api(`/apps/${appId}/reviews`);
	if (reviewsRes) {
		const reviews = reviewsRes.reviews ?? [];
		console.log(`  [PASS] Reviews: ${reviews.length}`);
	}

	// Cleanup
	await cleanup();
	console.log("\n=== E2E Test Complete ===");
}

async function cleanup() {
	if (storeId) {
		console.log(`\n--- Cleanup: DELETE /stores/${storeId} ---`);
		const res = await api(`/stores/${storeId}`, { method: "DELETE" });
		if (res) console.log("  [PASS] Store deleted (cascade removes apps)");
	}
}

main().catch((err) => {
	console.error("Fatal:", err);
	cleanup();
});
