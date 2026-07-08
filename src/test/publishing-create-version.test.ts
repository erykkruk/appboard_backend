import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { publishingController } from "@/modules/publishing";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
} from "@/test/setup";
import { encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import {
	apps,
	appVersions,
	stores,
	versionLocalizations,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";

describe("Publishing create-version (auto-copy languages)", () => {
	const testApp = new Elysia()
		.use(authGuard)
		.use(errorHandler)
		.group("/api", (app) => app.use(publishingController));

	let storeId: string;
	let appId: string;
	let versionId: string;

	beforeAll(async () => {
		// Seed an App Store mock store
		const creds = encrypt(JSON.stringify({ mock: true }));
		const [store] = await db
			.insert(stores)
			.values({
				credentials: creds,
				name: "Test iOS Store (create-version)",
				status: "connected",
				type: "app_store",
				workspaceId: getTestWorkspaceId(),
			})
			.returning();
		storeId = store.id;

		// Seed an app
		const [testAppRecord] = await db
			.insert(apps)
			.values({
				bundleId: "com.test.create-version",
				externalId: "ext-create-version-test",
				name: "Create Version Test App",
				platform: "ios",
				storeId,
			})
			.returning();
		appId = testAppRecord.id;

		// Seed a previous version with localizations
		const [version] = await db
			.insert(appVersions)
			.values({
				appId,
				externalId: "prev-version-ext-id",
				isEditable: false,
				state: "READY_FOR_SALE",
				versionString: "1.0.0",
			})
			.returning();
		versionId = version.id;

		// Seed 3 remote localizations for the previous version
		await db.insert(versionLocalizations).values([
			{
				appId,
				language: "en-US",
				source: "remote",
				versionId,
			},
			{
				appId,
				language: "pl",
				source: "remote",
				versionId,
			},
			{
				appId,
				language: "de-DE",
				source: "remote",
				versionId,
			},
			{
				// local-only localization — should NOT be copied
				appId,
				language: "fr-FR",
				source: "local",
				versionId,
			},
		]);
	});

	afterAll(async () => {
		await cleanupStores([storeId]);
	});

	it("copies remote languages from previous version", async () => {
		const res = await testApp.handle(
			authRequest(
				`http://localhost/api/apps/${appId}/publishing/create-version`,
				{
					body: JSON.stringify({ versionString: "1.1.0" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		const version = data.version;

		expect(version.state).toBe("PREPARE_FOR_SUBMISSION");
		expect(version.versionString).toBe("1.1.0");

		// Should copy only remote localizations (en-US, pl, de-DE), not local (fr-FR)
		expect(version.copiedLanguages).toBeArrayOfSize(3);
		expect(version.copiedLanguages.sort()).toEqual(
			["de-DE", "en-US", "pl"].sort(),
		);
	});

	it("returns empty copiedLanguages when no previous version exists", async () => {
		// Create a new app with no versions
		const [freshApp] = await db
			.insert(apps)
			.values({
				bundleId: "com.test.no-versions",
				externalId: "ext-no-versions-test",
				name: "No Versions App",
				platform: "ios",
				storeId,
			})
			.returning();

		const res = await testApp.handle(
			authRequest(
				`http://localhost/api/apps/${freshApp.id}/publishing/create-version`,
				{
					body: JSON.stringify({ versionString: "1.0.0" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.version.copiedLanguages).toEqual([]);
	});

	it("returns 400 for non-App Store apps", async () => {
		// Seed a Google Play store + app
		const creds = encrypt(JSON.stringify({ mock: true }));
		const [gpStore] = await db
			.insert(stores)
			.values({
				credentials: creds,
				name: "Test GP Store",
				status: "connected",
				type: "google_play",
				workspaceId: getTestWorkspaceId(),
			})
			.returning();

		const [gpApp] = await db
			.insert(apps)
			.values({
				bundleId: "com.test.gp",
				externalId: "ext-gp-test",
				name: "GP App",
				platform: "android",
				storeId: gpStore.id,
			})
			.returning();

		const res = await testApp.handle(
			authRequest(
				`http://localhost/api/apps/${gpApp.id}/publishing/create-version`,
				{
					body: JSON.stringify({ versionString: "1.0.0" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(400);

		// Cleanup
		await cleanupStores([gpStore.id]);
	});

	it("workspace B cannot create version for workspace A app", async () => {
		const res = await testApp.handle(
			authRequestB(
				`http://localhost/api/apps/${appId}/publishing/create-version`,
				{
					body: JSON.stringify({ versionString: "2.0.0" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			),
		);

		expect(res.status).toBe(404);
	});
});
