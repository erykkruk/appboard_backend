import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { PublishingService } from "@/modules/publishing/publishing.service";

/**
 * Helper to create a File object from a Buffer
 */
function createFileFromBuffer(buffer: Buffer, fileName = "test.png"): File {
	return new File([buffer], fileName, { type: "image/png" });
}

/**
 * Helper to create a solid color image buffer
 */
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

describe("Screenshot processing", () => {
	test("Portrait source without cropParams produces portrait target dimensions", async () => {
		// Create a portrait test image (1125x2436 - iPhone 5.8" portrait)
		const portraitBuffer = await createTestImage(1125, 2436, {
			b: 0,
			g: 0,
			r: 255,
		});
		const file = createFileFromBuffer(portraitBuffer, "portrait.png");

		const result = await PublishingService.previewScreenshot(
			"APP_IPHONE_65",
			file,
		);

		// APP_IPHONE_65 portrait sizes: [1242, 2688] or [1284, 2778]
		// Should select portrait target
		expect(result.height).toBeGreaterThan(result.width);
		expect([1242, 1284]).toContain(result.width);
		expect([2688, 2778]).toContain(result.height);
	});

	test("Landscape source without cropParams produces landscape target dimensions", async () => {
		// Create a landscape test image (2436x1125 - iPhone 5.8" landscape)
		const landscapeBuffer = await createTestImage(2436, 1125, {
			b: 0,
			g: 255,
			r: 0,
		});
		const file = createFileFromBuffer(landscapeBuffer, "landscape.png");

		const result = await PublishingService.previewScreenshot(
			"APP_IPHONE_65",
			file,
		);

		// APP_IPHONE_65 landscape sizes: [2688, 1242] or [2778, 1284]
		// Should select landscape target
		expect(result.width).toBeGreaterThan(result.height);
		expect([2688, 2778]).toContain(result.width);
		expect([1242, 1284]).toContain(result.height);
	});

	test("Landscape source WITH portrait cropParams produces portrait target dimensions", async () => {
		// Create a landscape test image (3000x2000)
		const landscapeBuffer = await createTestImage(3000, 2000, {
			b: 255,
			g: 0,
			r: 0,
		});
		const file = createFileFromBuffer(landscapeBuffer, "landscape-crop.png");

		// Crop params that define a portrait region (width < height)
		const portraitCropParams = {
			height: 1800,
			width: 900,
			x: 100,
			y: 100,
		};

		const result = await PublishingService.previewScreenshot(
			"APP_IPHONE_65",
			file,
			portraitCropParams,
		);

		// Should detect portrait orientation from crop params and select portrait target
		expect(result.height).toBeGreaterThan(result.width);
		expect([1242, 1284]).toContain(result.width);
		expect([2688, 2778]).toContain(result.height);
	});

	test("Portrait source WITH landscape cropParams produces landscape target dimensions", async () => {
		// Create a portrait test image (2000x3000)
		const portraitBuffer = await createTestImage(2000, 3000, {
			b: 0,
			g: 255,
			r: 255,
		});
		const file = createFileFromBuffer(portraitBuffer, "portrait-crop.png");

		// Crop params that define a landscape region (width > height)
		const landscapeCropParams = {
			height: 900,
			width: 1800,
			x: 100,
			y: 100,
		};

		const result = await PublishingService.previewScreenshot(
			"APP_IPHONE_65",
			file,
			landscapeCropParams,
		);

		// Should detect landscape orientation from crop params and select landscape target
		expect(result.width).toBeGreaterThan(result.height);
		expect([2688, 2778]).toContain(result.width);
		expect([1242, 1284]).toContain(result.height);
	});

	test("Output is valid PNG with correct dimensions", async () => {
		// Create a test image
		const testBuffer = await createTestImage(1125, 2436, {
			b: 128,
			g: 128,
			r: 128,
		});
		const file = createFileFromBuffer(testBuffer, "test.png");

		const result = await PublishingService.previewScreenshot(
			"APP_IPHONE_65",
			file,
		);

		// Extract base64 data and validate it's a valid PNG
		expect(result.preview).toStartWith("data:image/png;base64,");

		const base64Data = result.preview.replace("data:image/png;base64,", "");
		const imageBuffer = Buffer.from(base64Data, "base64");

		// Use sharp to validate the output
		const metadata = await sharp(imageBuffer).metadata();

		expect(metadata.format).toBe("png");
		expect(metadata.width).toBe(result.width);
		expect(metadata.height).toBe(result.height);
		expect(metadata.channels).toBe(3); // Should be flattened (no alpha)
	});

	test("Auto-crops to match target aspect ratio when no cropParams provided", async () => {
		// Create a square test image (2000x2000)
		const squareBuffer = await createTestImage(2000, 2000, {
			b: 0,
			g: 128,
			r: 255,
		});
		const file = createFileFromBuffer(squareBuffer, "square.png");

		const result = await PublishingService.previewScreenshot(
			"APP_IPHONE_65",
			file,
		);

		// Should auto-select portrait or landscape based on first available size
		// and crop/resize appropriately
		expect(result.width).toBeGreaterThan(0);
		expect(result.height).toBeGreaterThan(0);

		// Verify aspect ratio matches one of the valid sizes for APP_IPHONE_65
		const aspectRatio = result.width / result.height;
		const validAspectRatios = [
			1242 / 2688,
			2688 / 1242,
			1284 / 2778,
			2778 / 1284,
		];

		const hasValidAspect = validAspectRatios.some(
			(ratio) => Math.abs(aspectRatio - ratio) < 0.01,
		);
		expect(hasValidAspect).toBe(true);
	});

	test("Throws error for unknown display type", async () => {
		const testBuffer = await createTestImage(1000, 1000);
		const file = createFileFromBuffer(testBuffer, "test.png");

		await expect(
			PublishingService.previewScreenshot("UNKNOWN_DISPLAY_TYPE", file),
		).rejects.toThrow();
	});

	test("Handles different display types correctly", async () => {
		const testBuffer = await createTestImage(1125, 2436);
		const file = createFileFromBuffer(testBuffer, "test.png");

		// Test APP_IPHONE_58 (5.8" iPhone)
		const result58 = await PublishingService.previewScreenshot(
			"APP_IPHONE_58",
			file,
		);
		expect([1125, 2436]).toContain(result58.width);
		expect([1125, 2436]).toContain(result58.height);

		// Test APP_IPHONE_67 (6.7" iPhone)
		const result67 = await PublishingService.previewScreenshot(
			"APP_IPHONE_67",
			file,
		);
		expect([1290, 2796]).toContain(result67.width);
		expect([1290, 2796]).toContain(result67.height);
	});

	test("CropParams with exact target dimensions produces exact output", async () => {
		// Create a large test image
		const largeBuffer = await createTestImage(3000, 4000, {
			b: 255,
			g: 255,
			r: 0,
		});
		const file = createFileFromBuffer(largeBuffer, "large.png");

		// Crop to exact portrait aspect ratio for APP_IPHONE_65 (1242:2688)
		const exactCropParams = {
			height: 2688,
			width: 1242,
			x: 500,
			y: 500,
		};

		const result = await PublishingService.previewScreenshot(
			"APP_IPHONE_65",
			file,
			exactCropParams,
		);

		// Should produce exact target dimensions
		expect(result.width).toBe(1242);
		expect(result.height).toBe(2688);
	});

	test("CropParams handles fractional coordinates by rounding", async () => {
		const testBuffer = await createTestImage(2000, 3000);
		const file = createFileFromBuffer(testBuffer, "test.png");

		// Use fractional crop coordinates (as might come from UI)
		const fractionalCropParams = {
			height: 1800.7,
			width: 900.3,
			x: 100.5,
			y: 100.9,
		};

		const result = await PublishingService.previewScreenshot(
			"APP_IPHONE_65",
			file,
			fractionalCropParams,
		);

		// Should succeed without errors (Sharp rounds internally)
		expect(result.width).toBeGreaterThan(0);
		expect(result.height).toBeGreaterThan(0);
		expect(result.height).toBeGreaterThan(result.width); // Portrait
	});
});
