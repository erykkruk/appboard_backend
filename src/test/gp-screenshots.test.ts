import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { PublishingService } from "@/modules/publishing/publishing.service";
import { cleanupStores } from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { db } from "@/utils/db";
import { assets } from "@/utils/db/schema";

let store: Awaited<ReturnType<typeof seedTestStore>>;
let gpApp: Awaited<ReturnType<typeof seedTestApp>>;

const STORE_IDS: string[] = [];

async function createTestImage(width: number, height: number): Promise<Buffer> {
	return sharp({
		create: {
			background: { b: 0, g: 0, r: 255 },
			channels: 3,
			height,
			width,
		},
	})
		.png()
		.toBuffer();
}

function createFileFromBuffer(buffer: Buffer, fileName = "test.png"): File {
	return new File([buffer], fileName, { type: "image/png" });
}

beforeAll(async () => {
	store = await seedTestStore();
	STORE_IDS.push(store.id);
	gpApp = await seedTestApp(store.id);
});

afterAll(async () => {
	// Cleanup assets for this app
	await db.delete(assets).where(eq(assets.appId, gpApp.id));
	await cleanupStores(STORE_IDS);
});

describe("Google Play Screenshots", () => {
	test("uploadScreenshot uploads via AssetsService and returns screenshotId", async () => {
		const buffer = await createTestImage(1284, 2778);
		const file = createFileFromBuffer(buffer, "screenshot.png");

		const result = await PublishingService.uploadScreenshot(
			gpApp.id,
			"unused-version-id",
			"en-US",
			"phone",
			file,
		);

		expect(result).toBeDefined();
		expect(result!.uploaded).toBe(true);
		expect(result!.screenshotId).toBeDefined();

		// Verify asset was created in DB
		const dbAssets = await db
			.select()
			.from(assets)
			.where(
				and(
					eq(assets.appId, gpApp.id),
					eq(assets.assetType, "screenshot"),
					eq(assets.language, "en-US"),
				),
			);
		expect(dbAssets.length).toBeGreaterThanOrEqual(1);
	});

	test("deleteScreenshot removes asset from DB", async () => {
		// First upload a screenshot
		const buffer = await createTestImage(1284, 2778);
		const file = createFileFromBuffer(buffer, "to-delete.png");

		const uploaded = await PublishingService.uploadScreenshot(
			gpApp.id,
			"unused-version-id",
			"en-US",
			"phone",
			file,
		);

		const screenshotId = uploaded!.screenshotId;

		// Now delete it
		const result = await PublishingService.deleteScreenshot(
			gpApp.id,
			screenshotId,
		);
		expect(result).toEqual({ deleted: true });
	});

	test("deleteScreenshot returns 404 for non-existent screenshot", async () => {
		try {
			await PublishingService.deleteScreenshot(
				gpApp.id,
				"00000000-0000-0000-0000-000000000099",
			);
			throw new Error("Expected rejection");
		} catch (err: unknown) {
			const response = (err as { response?: { code?: string } })?.response;
			expect(response?.code).toBe("NOT_FOUND");
		}
	});

	test("reorderScreenshots updates sort order in DB", async () => {
		// Upload two screenshots
		const buffer1 = await createTestImage(1284, 2778);
		const buffer2 = await createTestImage(1284, 2778);

		const r1 = await PublishingService.uploadScreenshot(
			gpApp.id,
			"v",
			"ja",
			"phone",
			createFileFromBuffer(buffer1, "a.png"),
		);
		const r2 = await PublishingService.uploadScreenshot(
			gpApp.id,
			"v",
			"ja",
			"phone",
			createFileFromBuffer(buffer2, "b.png"),
		);

		const id1 = r1!.screenshotId;
		const id2 = r2!.screenshotId;

		// Reorder: put id2 first
		const result = await PublishingService.reorderScreenshots(
			gpApp.id,
			"gp-phone-ja",
			[id2, id1],
		);
		expect(result).toEqual({ reordered: true });

		// Verify order in DB
		const dbAssets = await db
			.select()
			.from(assets)
			.where(
				and(
					eq(assets.appId, gpApp.id),
					eq(assets.assetType, "screenshot"),
					eq(assets.language, "ja"),
				),
			)
			.orderBy(assets.sortOrder);

		expect(dbAssets.length).toBe(2);
		expect(dbAssets[0].externalId ?? dbAssets[0].id).toBe(id2);
		expect(dbAssets[1].externalId ?? dbAssets[1].id).toBe(id1);
	});

	test("deleteAllScreenshots removes all assets for a device type and language", async () => {
		// Upload screenshots for a specific locale
		const buffer = await createTestImage(1284, 2778);

		await PublishingService.uploadScreenshot(
			gpApp.id,
			"v",
			"de-DE",
			"phone",
			createFileFromBuffer(buffer, "de1.png"),
		);
		await PublishingService.uploadScreenshot(
			gpApp.id,
			"v",
			"de-DE",
			"phone",
			createFileFromBuffer(buffer, "de2.png"),
		);

		const result = await PublishingService.deleteAllScreenshots(
			gpApp.id,
			"gp-phone-de-DE",
		);
		expect(result.deleted).toBe(2);

		// Verify none left
		const remaining = await db
			.select()
			.from(assets)
			.where(
				and(
					eq(assets.appId, gpApp.id),
					eq(assets.assetType, "screenshot"),
					eq(assets.language, "de-DE"),
				),
			);
		expect(remaining.length).toBe(0);
	});

	test("getVersionScreenshots returns GP assets in correct format", async () => {
		// Upload a screenshot first
		const buffer = await createTestImage(1284, 2778);
		await PublishingService.uploadScreenshot(
			gpApp.id,
			"v",
			"fr-FR",
			"phone",
			createFileFromBuffer(buffer, "fr.png"),
		);

		const result = await PublishingService.getVersionScreenshots(
			gpApp.id,
			"any-version-id",
		);

		const frScreenshots = result.screenshots.filter(
			(s) => s.language === "fr-FR",
		);
		expect(frScreenshots.length).toBeGreaterThanOrEqual(1);

		const screenshot = frScreenshots[0];
		expect(screenshot.deviceType).toBe("phone");
		expect(screenshot.displayType).toBe("phone");
		expect(screenshot.language).toBe("fr-FR");
		expect(screenshot.screenshotSetId).toBe("gp-phone-fr-FR");
		expect(screenshot.externalId).toBeDefined();
	});

	test("splitUpload splits panorama and uploads parts for GP", async () => {
		// Create a panorama image (wide aspect ratio)
		const panoramaBuffer = await createTestImage(6000, 1000);
		const file = createFileFromBuffer(panoramaBuffer, "panorama.png");

		const result = await PublishingService.splitUpload(
			gpApp.id,
			"v",
			"ko",
			"phone",
			file,
			3,
		);

		expect(result.uploaded).toBe(3);
		expect(result.screenshotIds.length).toBe(3);

		// Verify assets in DB
		const dbAssets = await db
			.select()
			.from(assets)
			.where(
				and(
					eq(assets.appId, gpApp.id),
					eq(assets.assetType, "screenshot"),
					eq(assets.language, "ko"),
				),
			);
		expect(dbAssets.length).toBe(3);
	});
});
