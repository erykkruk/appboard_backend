import { readFileSync } from "node:fs";
import { GooglePlayProvider } from "@/providers/google-play";

// Configure via .env (gitignored): point these at your own local Google Play
// service-account key file and a package name you own.
const KEY_PATH = process.env.GP_SERVICE_ACCOUNT_KEY_PATH;
const TARGET_APP = process.env.GP_TEST_PACKAGE_NAME;

if (!KEY_PATH || !TARGET_APP) {
	console.error(
		"Set GP_SERVICE_ACCOUNT_KEY_PATH and GP_TEST_PACKAGE_NAME in your .env to run this script.",
	);
	process.exit(1);
}

function loadCredentials() {
	const raw = JSON.parse(readFileSync(KEY_PATH, "utf-8"));
	return {
		client_email: raw.client_email,
		private_key: raw.private_key,
		private_key_id: raw.private_key_id,
		project_id: raw.project_id,
		type: raw.type,
	};
}

function pass(label: string) {
	console.log(`  [PASS] ${label}`);
}

function fail(label: string, err: unknown) {
	console.log(`  [FAIL] ${label}`);
	console.log(`         ${err instanceof Error ? err.message : String(err)}`);
}

function header(title: string) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`  ${title}`);
	console.log("=".repeat(60));
}

async function main() {
	console.log("Loading service account key from", KEY_PATH);
	const credentials = loadCredentials();
	console.log("Service account:", credentials.client_email);

	const provider = new GooglePlayProvider(credentials);

	// 1. Validate credentials
	header("1. validateCredentials()");
	try {
		const valid = await provider.validateCredentials();
		if (valid) {
			pass("Credentials are valid");
		} else {
			fail("Credentials validation returned false", "invalid credentials");
		}
	} catch (err) {
		fail("validateCredentials threw", err);
	}

	// 2. Fetch apps (auto-discovery)
	header("2. fetchApps() — auto-discovery");
	let apps: Awaited<ReturnType<typeof provider.fetchApps>> = [];
	try {
		apps = await provider.fetchApps();
		pass(`Found ${apps.length} app(s)`);
		for (const app of apps) {
			console.log(`    - ${app.name} (${app.bundleId})`);
			if (app.iconUrl) console.log(`      icon: ${app.iconUrl}`);
		}

		const found = apps.find((a) => a.bundleId === TARGET_APP);
		if (found) {
			pass(`Target app "${TARGET_APP}" discovered`);
		} else {
			fail(
				`Target app "${TARGET_APP}" NOT found in discovered apps`,
				"missing",
			);
		}
	} catch (err) {
		fail("fetchApps threw", err);
	}

	// 3. Fetch listings
	header(`3. fetchListings("${TARGET_APP}")`);
	try {
		const listings = await provider.fetchListings(TARGET_APP);
		pass(`Found ${listings.length} listing(s)`);
		for (const listing of listings) {
			console.log(`    [${listing.language}] "${listing.title}"`);
			console.log(
				`      short: ${listing.shortDesc.slice(0, 80)}${listing.shortDesc.length > 80 ? "..." : ""}`,
			);
			console.log(
				`      full:  ${listing.fullDesc.slice(0, 80)}${listing.fullDesc.length > 80 ? "..." : ""}`,
			);
		}
	} catch (err) {
		fail("fetchListings threw", err);
	}

	// 4. Fetch assets
	header(`4. fetchAssets("${TARGET_APP}", "en-US")`);
	try {
		const assets = await provider.fetchAssets(TARGET_APP, "en-US");
		pass(`Found ${assets.length} asset(s)`);
		for (const asset of assets) {
			console.log(
				`    [${asset.assetType}] device=${asset.deviceType} id=${asset.externalId}`,
			);
			console.log(`      url: ${asset.url}`);
		}
	} catch (err) {
		fail("fetchAssets threw", err);
	}

	// 5. Fetch reviews
	header(`5. fetchReviews("${TARGET_APP}")`);
	try {
		const reviews = await provider.fetchReviews(TARGET_APP);
		pass(`Found ${reviews.length} review(s)`);
		for (const review of reviews.slice(0, 5)) {
			console.log(
				`    [${review.rating}/5] by ${review.authorName} (${review.language ?? "?"})`,
			);
			console.log(
				`      "${review.body.slice(0, 100)}${review.body.length > 100 ? "..." : ""}"`,
			);
			if (review.replyText) {
				console.log(`      reply: "${review.replyText.slice(0, 80)}..."`);
			}
		}
		if (reviews.length > 5) {
			console.log(`    ... and ${reviews.length - 5} more`);
		}
	} catch (err) {
		fail("fetchReviews threw", err);
	}

	header("Done");
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
