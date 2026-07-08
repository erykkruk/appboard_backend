import { afterAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import sharp from "sharp";
import { publishingController } from "@/modules/publishing";
import { PublishingService } from "@/modules/publishing/publishing.service";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { errorHandler } from "@/utils/errors/errorHandler";

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

const app = new Elysia()
	.use(authGuard)
	.use(errorHandler)
	.group("/api", (a) => a.use(publishingController));

const seededStoreIds: string[] = [];

afterAll(async () => {
	await cleanupStores(seededStoreIds);
});

describe("PublishingService.validateScreenshotFile", () => {
	test("Apple display type: correct-size buffer is valid", async () => {
		// APP_IPHONE_67 portrait preset: 1290x2796
		const buffer = await createTestImage(1290, 2796);
		const file = createFileFromBuffer(buffer, "iphone67.png");

		const result = await PublishingService.validateScreenshotFile(
			"APP_IPHONE_67",
			file,
		);

		expect(result.valid).toBe(true);
		expect(result.providedDimensions).toEqual([1290, 2796]);
		expect(result.supportedDimensions).toContainEqual([1290, 2796]);
	});

	test("Apple display type: wrong-size buffer is invalid with suggestion", async () => {
		const buffer = await createTestImage(1000, 2000);
		const file = createFileFromBuffer(buffer, "wrong.png");

		const result = await PublishingService.validateScreenshotFile(
			"APP_IPHONE_67",
			file,
		);

		expect(result.valid).toBe(false);
		expect(result.providedDimensions).toEqual([1000, 2000]);
		expect(result.supportedDimensions).toContainEqual([1290, 2796]);
		expect(result.suggestion).toContain("1290x2796");
		expect(result.suggestion).toContain("1000x2000");
		expect(result.suggestion).toContain('iPhone 6.7"');
	});

	test("Google Play display type: correct-size buffer is valid", async () => {
		// phone preset includes 1284x2778
		const buffer = await createTestImage(1284, 2778);
		const file = createFileFromBuffer(buffer, "phone.png");

		const result = await PublishingService.validateScreenshotFile(
			"phone",
			file,
		);

		expect(result.valid).toBe(true);
		expect(result.displayTypeName).toBe("Android phone");
	});

	test("Google Play accepts flexible sizes within GP bounds (1080x1920)", async () => {
		// GP does not enforce exact presets — each side 320-3840px, aspect <= 2:1.
		const buffer = await createTestImage(1080, 1920);
		const file = createFileFromBuffer(buffer, "phone-1080.png");

		const result = await PublishingService.validateScreenshotFile(
			"phone",
			file,
		);

		expect(result.valid).toBe(true);
		expect(result.providedDimensions).toEqual([1080, 1920]);
	});

	test("Google Play accepts non-preset sizes like 800x1600 (aspect exactly 2:1)", async () => {
		const buffer = await createTestImage(800, 1600);
		const file = createFileFromBuffer(buffer, "phone-800.png");

		const result = await PublishingService.validateScreenshotFile(
			"phone",
			file,
		);

		expect(result.valid).toBe(true);
	});

	test("Google Play rejects sides below 320px", async () => {
		const buffer = await createTestImage(300, 600);
		const file = createFileFromBuffer(buffer, "phone-tiny.png");

		const result = await PublishingService.validateScreenshotFile(
			"phone",
			file,
		);

		expect(result.valid).toBe(false);
		expect(result.providedDimensions).toEqual([300, 600]);
		expect(result.suggestion).toContain("320");
		expect(result.suggestion).toContain("300x600");
	});

	test("Google Play rejects aspect ratio above 2:1", async () => {
		const buffer = await createTestImage(1000, 2500);
		const file = createFileFromBuffer(buffer, "phone-tall.png");

		const result = await PublishingService.validateScreenshotFile(
			"phone",
			file,
		);

		expect(result.valid).toBe(false);
		expect(result.suggestion).toContain("2:1");
	});

	test("Google Play rejects sides above 3840px", async () => {
		const buffer = await createTestImage(2200, 4000);
		const file = createFileFromBuffer(buffer, "phone-huge.png");

		const result = await PublishingService.validateScreenshotFile(
			"phone",
			file,
		);

		expect(result.valid).toBe(false);
		expect(result.suggestion).toContain("3840");
	});

	test("Landscape orientation of a preset is accepted", async () => {
		// APP_IPHONE_67 also accepts landscape 2796x1290
		const buffer = await createTestImage(2796, 1290);
		const file = createFileFromBuffer(buffer, "landscape.png");

		const result = await PublishingService.validateScreenshotFile(
			"APP_IPHONE_67",
			file,
		);

		expect(result.valid).toBe(true);
	});

	test("Unknown display type raises a typed badRequest", async () => {
		const buffer = await createTestImage(1290, 2796);
		const file = createFileFromBuffer(buffer, "x.png");

		try {
			await PublishingService.validateScreenshotFile("NOT_A_TYPE", file);
			throw new Error("Expected rejection");
		} catch (err: unknown) {
			const response = (err as { response?: { code?: string } })?.response;
			expect(response?.code).toBe("BAD_REQUEST");
		}
	});
});

describe("PublishingService.uploadScreenshot dimension guard", () => {
	let store: Awaited<ReturnType<typeof seedTestStore>>;
	let gpApp: Awaited<ReturnType<typeof seedTestApp>>;

	test("wrong-size upload throws typed dimension error with structured data", async () => {
		store = await seedTestStore();
		seededStoreIds.push(store.id);
		gpApp = await seedTestApp(store.id);

		const buffer = await createTestImage(1000, 2000);
		const file = createFileFromBuffer(buffer, "wrong.png");

		try {
			await PublishingService.uploadScreenshot(
				gpApp.id,
				"unused-version-id",
				"en-US",
				"APP_IPHONE_67",
				file,
			);
			throw new Error("Expected rejection");
		} catch (err: unknown) {
			const response = (
				err as {
					response?: {
						code?: string;
						data?: {
							providedDimensions?: [number, number];
							supportedDimensions?: [number, number][];
							suggestion?: string;
						};
					};
				}
			)?.response;
			expect(response?.code).toBe("INVALID_SCREENSHOT_DIMENSIONS");
			expect(response?.data?.providedDimensions).toEqual([1000, 2000]);
			expect(response?.data?.supportedDimensions).toContainEqual([1290, 2796]);
			expect(response?.data?.suggestion).toContain("1290x2796");
		}
	});

	test("GP upload accepts 1080x1920 and preserves original dimensions (pass-through)", async () => {
		const buffer = await createTestImage(1080, 1920);
		const file = createFileFromBuffer(buffer, "gp-1080.png");

		const result = await PublishingService.uploadScreenshot(
			gpApp.id,
			"unused-version-id",
			"en-US",
			"phone",
			file,
		);

		expect(result!.uploaded).toBe(true);
	});

	test("explicit cropParams bypass the dimension guard", async () => {
		// A wrong-size source with crop params is the user intentionally adjusting:
		// it must not throw the dimension error, the crop/resize pipeline handles it.
		const buffer = await createTestImage(3000, 4000);
		const file = createFileFromBuffer(buffer, "crop.png");

		const result = await PublishingService.uploadScreenshot(
			gpApp.id,
			"unused-version-id",
			"en-US",
			"APP_IPHONE_67",
			file,
			{ height: 2796, width: 1290, x: 100, y: 100 },
		);

		expect(result!.uploaded).toBe(true);
	});
});

describe("POST /api/apps/:appId/publishing/screenshots/validate", () => {
	let store: Awaited<ReturnType<typeof seedTestStore>>;
	let gpApp: Awaited<ReturnType<typeof seedTestApp>>;

	function buildForm(buffer: Buffer, displayType: string): FormData {
		const form = new FormData();
		form.append("file", new Blob([buffer], { type: "image/png" }), "shot.png");
		form.append("displayType", displayType);
		return form;
	}

	test("returns valid:true for a correct-size screenshot", async () => {
		store = await seedTestStore();
		seededStoreIds.push(store.id);
		gpApp = await seedTestApp(store.id);

		const buffer = await createTestImage(1290, 2796);
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${gpApp.id}/publishing/screenshots/validate`,
				{ body: buildForm(buffer, "APP_IPHONE_67"), method: "POST" },
			),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.valid).toBe(true);
		expect(data.providedDimensions).toEqual([1290, 2796]);
	});

	test("returns valid:false with suggestion for a wrong-size screenshot", async () => {
		const buffer = await createTestImage(1000, 2000);
		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${gpApp.id}/publishing/screenshots/validate`,
				{ body: buildForm(buffer, "APP_IPHONE_67"), method: "POST" },
			),
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.valid).toBe(false);
		expect(data.supportedDimensions).toContainEqual([1290, 2796]);
		expect(data.suggestion).toContain("1290x2796");
	});

	test("workspace B cannot validate against workspace A's app (404)", async () => {
		const buffer = await createTestImage(1290, 2796);
		const res = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${gpApp.id}/publishing/screenshots/validate`,
				{ body: buildForm(buffer, "APP_IPHONE_67"), method: "POST" },
			),
		);

		expect(res.status).toBe(404);
	});
});
