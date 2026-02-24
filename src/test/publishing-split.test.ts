import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { PublishingService } from "@/modules/publishing/publishing.service";

function createFileFromBuffer(buffer: Buffer, fileName = "test.png"): File {
	return new File([buffer], fileName, { type: "image/png" });
}

async function createTestImage(
	width: number,
	height: number,
	color: { r: number; g: number; b: number } = { b: 0, g: 0, r: 255 },
): Promise<Buffer> {
	return sharp({
		create: {
			background: color,
			channels: 3,
			height,
			width,
		},
	})
		.png()
		.toBuffer();
}

async function expectBadRequest(
	promise: Promise<unknown>,
	infoPattern: RegExp,
) {
	try {
		await promise;
		throw new Error("Expected rejection but promise resolved");
	} catch (err: unknown) {
		const response = (
			err as { response?: { code?: string; data?: { info?: string } } }
		)?.response;
		expect(response?.code).toBe("BAD_REQUEST");
		expect(response?.data?.info).toMatch(infoPattern);
	}
}

describe("Screenshot split-preview", () => {
	test("Returns correct dimensions and suggested parts for a panorama", async () => {
		// Create a panorama: 6000x1000 (6:1 ratio)
		const panoramaBuffer = await createTestImage(6000, 1000);
		const file = createFileFromBuffer(panoramaBuffer, "panorama.png");

		const result = await PublishingService.splitPreview(
			"APP_IPHONE_65",
			file,
			4,
		);

		expect(result.originalWidth).toBe(6000);
		expect(result.originalHeight).toBe(1000);
		expect(result.parts).toBe(4);
		expect(result.partWidth).toBe(1500);
		expect(result.partHeight).toBe(1000);
		expect(result.targetWidth).toBeGreaterThan(0);
		expect(result.targetHeight).toBeGreaterThan(0);
		// Portrait target: height > width
		expect(result.targetHeight).toBeGreaterThan(result.targetWidth);
		expect(result.suggestedParts).toBeGreaterThanOrEqual(2);
		expect(result.suggestedParts).toBeLessThanOrEqual(10);
		expect(result.previewUrl).toStartWith("data:image/png;base64,");
	});

	test("Preview image is a valid PNG", async () => {
		const panoramaBuffer = await createTestImage(4000, 800);
		const file = createFileFromBuffer(panoramaBuffer, "panorama.png");

		const result = await PublishingService.splitPreview(
			"APP_IPHONE_65",
			file,
			3,
		);

		const base64Data = result.previewUrl.replace("data:image/png;base64,", "");
		const imageBuffer = Buffer.from(base64Data, "base64");
		const metadata = await sharp(imageBuffer).metadata();

		expect(metadata.format).toBe("png");
		expect(metadata.width).toBeGreaterThan(0);
		expect(metadata.height).toBeGreaterThan(0);
	});

	test("Suggested parts is reasonable for 6-screen panorama", async () => {
		// iPhone 6.5" portrait: 1242x2688 → aspect ~0.462
		// Panorama 6x2688 wide → width = 6 * 1242 = 7452
		const panoramaBuffer = await createTestImage(7452, 2688);
		const file = createFileFromBuffer(panoramaBuffer, "6screens.png");

		const result = await PublishingService.splitPreview(
			"APP_IPHONE_65",
			file,
			6,
		);

		// Suggested should be close to 6 based on aspect ratio
		expect(result.suggestedParts).toBeGreaterThanOrEqual(5);
		expect(result.suggestedParts).toBeLessThanOrEqual(7);
	});

	test("Rejects non-panorama image (portrait)", async () => {
		const portraitBuffer = await createTestImage(1000, 2000);
		const file = createFileFromBuffer(portraitBuffer, "portrait.png");

		await expectBadRequest(
			PublishingService.splitPreview("APP_IPHONE_65", file, 3),
			/panorama/i,
		);
	});

	test("Rejects non-panorama image (nearly square)", async () => {
		const squareBuffer = await createTestImage(1400, 1000);
		const file = createFileFromBuffer(squareBuffer, "square.png");

		await expectBadRequest(
			PublishingService.splitPreview("APP_IPHONE_65", file, 3),
			/panorama/i,
		);
	});

	test("Accepts image exactly at panorama threshold", async () => {
		// width = height * 1.5 exactly → should pass
		const thresholdBuffer = await createTestImage(1500, 1000);
		const file = createFileFromBuffer(thresholdBuffer, "threshold.png");

		const result = await PublishingService.splitPreview(
			"APP_IPHONE_65",
			file,
			2,
		);

		expect(result.originalWidth).toBe(1500);
		expect(result.parts).toBe(2);
	});

	test("Rejects parts below minimum (1)", async () => {
		const panoramaBuffer = await createTestImage(3000, 1000);
		const file = createFileFromBuffer(panoramaBuffer, "panorama.png");

		await expectBadRequest(
			PublishingService.splitPreview("APP_IPHONE_65", file, 1),
			/Parts must be between/,
		);
	});

	test("Rejects parts above maximum (11)", async () => {
		const panoramaBuffer = await createTestImage(3000, 1000);
		const file = createFileFromBuffer(panoramaBuffer, "panorama.png");

		await expectBadRequest(
			PublishingService.splitPreview("APP_IPHONE_65", file, 11),
			/Parts must be between/,
		);
	});

	test("Rejects unknown display type", async () => {
		const panoramaBuffer = await createTestImage(3000, 1000);
		const file = createFileFromBuffer(panoramaBuffer, "panorama.png");

		await expectBadRequest(
			PublishingService.splitPreview("UNKNOWN_TYPE", file, 3),
			/Unknown display type/,
		);
	});

	test("Rejects image exceeding MAX_PIXEL_COUNT", async () => {
		// 15000x7000 = 105,000,000 pixels > MAX_PIXEL_COUNT (100,000,000)
		// Must still be a panorama (width >= height * 1.5)
		const hugeBuffer = await createTestImage(15000, 7000);
		const file = createFileFromBuffer(hugeBuffer, "huge.png");

		await expectBadRequest(
			PublishingService.splitPreview("APP_IPHONE_65", file, 3),
			/too large/i,
		);
	});

	test("Accepts image just under MAX_PIXEL_COUNT", async () => {
		// 12000x8000 = 96,000,000 pixels < 100,000,000, and 12000/8000 = 1.5 (panorama threshold)
		const largeBuffer = await createTestImage(12000, 8000);
		const file = createFileFromBuffer(largeBuffer, "large.png");

		const result = await PublishingService.splitPreview(
			"APP_IPHONE_65",
			file,
			3,
		);
		expect(result.originalWidth).toBe(12000);
		expect(result.originalHeight).toBe(8000);
	});

	test("Parts at minimum (2) and maximum (10) work correctly", async () => {
		const panoramaBuffer = await createTestImage(10000, 1000);
		const file = createFileFromBuffer(panoramaBuffer, "wide.png");

		const result2 = await PublishingService.splitPreview(
			"APP_IPHONE_65",
			file,
			2,
		);
		expect(result2.parts).toBe(2);
		expect(result2.partWidth).toBe(5000);

		const result10 = await PublishingService.splitPreview(
			"APP_IPHONE_65",
			file,
			10,
		);
		expect(result10.parts).toBe(10);
		expect(result10.partWidth).toBe(1000);
	});

	test("Works with different display types", async () => {
		const panoramaBuffer = await createTestImage(4000, 800);
		const file = createFileFromBuffer(panoramaBuffer, "panorama.png");

		const result55 = await PublishingService.splitPreview(
			"APP_IPHONE_55",
			file,
			3,
		);
		expect(result55.targetWidth).toBeGreaterThan(0);
		expect(result55.targetHeight).toBeGreaterThan(result55.targetWidth);

		const result67 = await PublishingService.splitPreview(
			"APP_IPHONE_67",
			file,
			3,
		);
		expect(result67.targetWidth).toBeGreaterThan(0);
		expect(result67.targetHeight).toBeGreaterThan(result67.targetWidth);
	});

	test("Part dimensions are consistent with original dimensions", async () => {
		const panoramaBuffer = await createTestImage(6000, 1200);
		const file = createFileFromBuffer(panoramaBuffer, "panorama.png");

		const result = await PublishingService.splitPreview(
			"APP_IPHONE_65",
			file,
			5,
		);

		// partWidth * parts should be <= originalWidth
		expect(result.partWidth * result.parts).toBeLessThanOrEqual(
			result.originalWidth,
		);
		expect(result.partHeight).toBe(result.originalHeight);
	});
});
