/**
 * ASO Research Script - Tests all available scraper functions
 * for both Google Play and App Store.
 *
 * Usage: bun run scripts/aso-research.ts
 */

import store from "app-store-scraper";
import gplay from "google-play-scraper";

const SEPARATOR = "=".repeat(80);
const SUB_SEPARATOR = "-".repeat(60);

function logSection(title: string) {
	console.log(`\n${SEPARATOR}`);
	console.log(`  ${title}`);
	console.log(SEPARATOR);
}

function logSubSection(title: string) {
	console.log(`\n${SUB_SEPARATOR}`);
	console.log(`  ${title}`);
	console.log(SUB_SEPARATOR);
}

function logFields(obj: Record<string, unknown>, prefix = "") {
	for (const [key, value] of Object.entries(obj)) {
		const type = Array.isArray(value) ? `Array(${value.length})` : typeof value;
		const preview =
			typeof value === "string"
				? value.length > 120
					? `${value.slice(0, 120)}...`
					: value
				: typeof value === "object" && value !== null
					? Array.isArray(value)
						? `[${value.length} items]`
						: "{object}"
					: String(value);
		console.log(`  ${prefix}${key}: (${type}) ${preview}`);
	}
}

async function runWithCatch<T>(
	label: string,
	fn: () => Promise<T>,
): Promise<T | null> {
	try {
		const result = await fn();
		return result;
	} catch (err) {
		console.error(`  ERROR in ${label}:`, (err as Error).message);
		return null;
	}
}

// ─── GOOGLE PLAY ────────────────────────────────────────────────────────────

async function testGooglePlay() {
	logSection("GOOGLE PLAY SCRAPER");

	// 1. App details
	logSubSection("1. gplay.app() - Full app details for com.spotify.music");
	const appData = await runWithCatch("gplay.app", () =>
		gplay.app({ appId: "com.spotify.music" }),
	);
	if (appData) {
		console.log("\n  Available fields:");
		logFields(appData as unknown as Record<string, unknown>);
	}

	// 2. Search
	logSubSection('2. gplay.search() - Search "music player" (top 10)');
	const searchResults = await runWithCatch("gplay.search", () =>
		gplay.search({ num: 10, term: "music player" }),
	);
	if (searchResults) {
		console.log(`  Total results: ${searchResults.length}`);
		console.log("\n  First result fields:");
		logFields(searchResults[0] as unknown as Record<string, unknown>);
		console.log("\n  All results (appId, title, score):");
		for (const r of searchResults) {
			const rec = r as unknown as Record<string, unknown>;
			console.log(`    - ${rec.appId} | ${rec.title} | score: ${rec.score}`);
		}
	}

	// 3. Similar apps
	logSubSection("3. gplay.similar() - Similar to Spotify");
	const similar = await runWithCatch("gplay.similar", () =>
		gplay.similar({ appId: "com.spotify.music" }),
	);
	if (similar) {
		console.log(`  Total similar: ${similar.length}`);
		console.log("\n  First 5:");
		for (const r of similar.slice(0, 5)) {
			const rec = r as unknown as Record<string, unknown>;
			console.log(`    - ${rec.appId} | ${rec.title}`);
		}
		console.log("\n  Fields in similar app result:");
		logFields(similar[0] as unknown as Record<string, unknown>);
	}

	// 4. Reviews
	logSubSection("4. gplay.reviews() - Recent reviews for Spotify");
	const reviewsResult = await runWithCatch("gplay.reviews", () =>
		gplay.reviews({
			appId: "com.spotify.music",
			num: 5,
			sort: gplay.sort.NEWEST,
		}),
	);
	if (reviewsResult) {
		const reviews = (reviewsResult as { data: unknown[] }).data;
		console.log(`  Total reviews returned: ${reviews.length}`);
		if (reviews.length > 0) {
			console.log("\n  First review fields:");
			logFields(reviews[0] as unknown as Record<string, unknown>);
			console.log("\n  All reviews preview:");
			for (const r of reviews) {
				const rec = r as unknown as Record<string, unknown>;
				console.log(
					`    - score: ${rec.score} | ${(rec.text as string)?.slice(0, 100)}...`,
				);
			}
		}
	}

	// 5. List (top apps in category)
	logSubSection("5. gplay.list() - Top apps in MUSIC_AND_AUDIO");
	const topApps = await runWithCatch("gplay.list", () =>
		gplay.list({
			category: gplay.category.MUSIC_AND_AUDIO,
			collection: gplay.collection.TOP_FREE,
			num: 10,
		}),
	);
	if (topApps) {
		console.log(`  Total: ${topApps.length}`);
		console.log("\n  Top 10:");
		for (const r of topApps) {
			const rec = r as unknown as Record<string, unknown>;
			console.log(`    - ${rec.appId} | ${rec.title} | score: ${rec.score}`);
		}
		console.log("\n  Fields in list result:");
		logFields(topApps[0] as unknown as Record<string, unknown>);
	}

	// 6. Suggest
	logSubSection('6. gplay.suggest() - Suggestions for "music"');
	const suggestions = await runWithCatch("gplay.suggest", () =>
		gplay.suggest({ term: "music" }),
	);
	if (suggestions) {
		console.log(`  Suggestions (${suggestions.length}):`);
		for (const s of suggestions) {
			console.log(`    - ${JSON.stringify(s)}`);
		}
	}

	// 7. Permissions
	logSubSection("7. gplay.permissions() - Permissions for Spotify");
	const permissions = await runWithCatch("gplay.permissions", () =>
		gplay.permissions({ appId: "com.spotify.music" }),
	);
	if (permissions) {
		console.log(`  Permission groups: ${permissions.length}`);
		for (const p of permissions.slice(0, 5)) {
			const rec = p as unknown as Record<string, unknown>;
			console.log(`    - ${rec.type}: ${JSON.stringify(rec)}`);
		}
	}
}

// ─── APP STORE ──────────────────────────────────────────────────────────────

async function testAppStore() {
	logSection("APP STORE SCRAPER");

	// 1. App details
	logSubSection(
		"1. store.app() - Full app details for Spotify (id: 324684580)",
	);
	const appData = await runWithCatch("store.app", () =>
		store.app({ id: 324684580 }),
	);
	if (appData) {
		console.log("\n  Available fields:");
		logFields(appData as unknown as Record<string, unknown>);
	}

	// 2. Search
	logSubSection('2. store.search() - Search "music player"');
	const searchResults = await runWithCatch("store.search", () =>
		store.search({ num: 10, term: "music player" }),
	);
	if (searchResults) {
		console.log(`  Total results: ${(searchResults as unknown[]).length}`);
		const results = searchResults as unknown as Record<string, unknown>[];
		if (results.length > 0) {
			console.log("\n  First result fields:");
			logFields(results[0]);
			console.log("\n  All results:");
			for (const r of results) {
				console.log(`    - ${r.appId} | ${r.title} | score: ${r.score}`);
			}
		}
	}

	// 3. Similar apps
	logSubSection("3. store.similar() - Similar to Spotify");
	const similar = await runWithCatch("store.similar", () =>
		store.similar({ id: 324684580 }),
	);
	if (similar) {
		const results = similar as unknown as Record<string, unknown>[];
		console.log(`  Total similar: ${results.length}`);
		if (results.length > 0) {
			console.log("\n  First 5:");
			for (const r of results.slice(0, 5)) {
				console.log(`    - ${r.appId} | ${r.title}`);
			}
			console.log("\n  Fields in similar app result:");
			logFields(results[0]);
		}
	}

	// 4. Reviews
	logSubSection("4. store.reviews() - Reviews for Spotify");
	const reviews = await runWithCatch("store.reviews", () =>
		store.reviews({ id: 324684580, page: 1, sort: store.sort.RECENT }),
	);
	if (reviews) {
		const results = reviews as unknown as Record<string, unknown>[];
		console.log(`  Total reviews: ${results.length}`);
		if (results.length > 0) {
			console.log("\n  First review fields:");
			logFields(results[0]);
			console.log("\n  All reviews preview:");
			for (const r of results.slice(0, 5)) {
				console.log(
					`    - score: ${r.score} | ${(r.text as string)?.slice(0, 100)}...`,
				);
			}
		}
	}

	// 5. List (top apps)
	logSubSection("5. store.list() - Top free apps");
	const topApps = await runWithCatch("store.list", () =>
		store.list({
			category: store.category.MUSIC,
			collection: store.collection.TOP_FREE_IOS,
			num: 10,
		}),
	);
	if (topApps) {
		const results = topApps as unknown as Record<string, unknown>[];
		console.log(`  Total: ${results.length}`);
		if (results.length > 0) {
			console.log("\n  Top apps:");
			for (const r of results) {
				console.log(`    - ${r.appId} | ${r.title}`);
			}
			console.log("\n  Fields in list result:");
			logFields(results[0]);
		}
	}

	// 6. Suggest
	logSubSection('6. store.suggest() - Suggestions for "music"');
	const suggestions = await runWithCatch("store.suggest", () =>
		store.suggest({ term: "music" }),
	);
	if (suggestions) {
		const results = suggestions as unknown as Record<string, unknown>[];
		console.log(`  Suggestions (${results.length}):`);
		for (const s of results) {
			console.log(`    - ${JSON.stringify(s)}`);
		}
	}
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
	console.log("ASO Research Script - Testing all scraper functions");
	console.log(`Started at: ${new Date().toISOString()}\n`);

	await testGooglePlay();
	await testAppStore();

	console.log(`\n${SEPARATOR}`);
	console.log("  DONE");
	console.log(SEPARATOR);
}

main().catch(console.error);
