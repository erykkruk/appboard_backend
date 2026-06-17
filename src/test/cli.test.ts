import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { run, runUpload } from "@/cli";

/** Build a tiny PNG buffer of the given dimensions for upload/validation tests. */
async function createPng(width: number, height: number): Promise<Buffer> {
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

/** A captured fetch call, reduced to what the assertions need. */
interface CapturedRequest {
	authorization: string | null;
	body: FormData | null;
	method: string;
	url: string;
}

/**
 * Install a fetch stub that records every request and answers based on the URL.
 * `routes` maps a URL substring to the JSON body returned (status 200). Returns
 * the captured requests plus a restore function.
 */
function stubFetch(routes: Record<string, unknown>) {
	const original = globalThis.fetch;
	const requests: CapturedRequest[] = [];

	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const headers = new Headers(init?.headers);
		const body = init?.body;
		requests.push({
			authorization: headers.get("authorization"),
			body: body instanceof FormData ? body : null,
			method: init?.method ?? "GET",
			url,
		});

		const match = Object.keys(routes).find((key) => url.includes(key));
		const payload = match ? routes[match] : {};
		return new Response(JSON.stringify(payload), {
			headers: { "content-type": "application/json" },
			status: 200,
		});
	}) as typeof fetch;

	return {
		requests,
		restore() {
			globalThis.fetch = original;
		},
	};
}

const APP_ID = "11111111-1111-1111-1111-111111111111";

describe("CLI argument parsing", () => {
	const originalKey = process.env.APPBOARD_API_KEY;

	beforeEach(() => {
		process.env.APPBOARD_API_KEY = "ab_testkey";
	});

	afterEach(() => {
		if (originalKey === undefined) delete process.env.APPBOARD_API_KEY;
		else process.env.APPBOARD_API_KEY = originalKey;
	});

	test("missing required flags returns exit code 1", async () => {
		const code = await runUpload(["--app", APP_ID]);
		expect(code).toBe(1);
	});

	test("invalid platform returns exit code 1", async () => {
		const code = await runUpload([
			"--app",
			APP_ID,
			"--lang",
			"en-US",
			"--platform",
			"windows",
			"--display-type",
			"APP_IPHONE_67",
			"/tmp/whatever",
		]);
		expect(code).toBe(1);
	});

	test("--help prints usage and exits 0", async () => {
		const code = await run(["--help"]);
		expect(code).toBe(0);
	});

	test("unknown command exits 1", async () => {
		const code = await run(["frobnicate"]);
		expect(code).toBe(1);
	});
});

describe("CLI auth", () => {
	const originalKey = process.env.APPBOARD_API_KEY;

	afterEach(() => {
		if (originalKey === undefined) delete process.env.APPBOARD_API_KEY;
		else process.env.APPBOARD_API_KEY = originalKey;
	});

	test("fails fast when APPBOARD_API_KEY is missing", async () => {
		delete process.env.APPBOARD_API_KEY;
		const code = await runUpload([
			"--app",
			APP_ID,
			"--lang",
			"en-US",
			"--platform",
			"gp",
			"--display-type",
			"phone",
			"/tmp/does-not-matter",
		]);
		expect(code).toBe(1);
	});
});

describe("CLI upload flow", () => {
	const originalKey = process.env.APPBOARD_API_KEY;
	let dir: string;

	beforeEach(async () => {
		process.env.APPBOARD_API_KEY = "ab_testkey";
		dir = await mkdtemp(join(tmpdir(), "appboard-cli-"));
	});

	afterEach(async () => {
		if (originalKey === undefined) delete process.env.APPBOARD_API_KEY;
		else process.env.APPBOARD_API_KEY = originalKey;
		await rm(dir, { force: true, recursive: true });
	});

	test("empty directory returns exit code 1", async () => {
		const stub = stubFetch({});
		try {
			const code = await runUpload([
				"--app",
				APP_ID,
				"--lang",
				"en-US",
				"--platform",
				"gp",
				"--display-type",
				"phone",
				dir,
			]);
			expect(code).toBe(1);
		} finally {
			stub.restore();
		}
	});

	test("happy path: validate ok then upload, both called with bearer header", async () => {
		await writeFile(join(dir, "01.png"), await createPng(1284, 2778));
		await writeFile(join(dir, "02.png"), await createPng(1284, 2778));

		const stub = stubFetch({
			"screenshots/upload": { screenshotId: "abc", uploaded: true },
			"screenshots/validate": {
				displayType: "phone",
				displayTypeName: "Android phone",
				providedDimensions: [1284, 2778],
				suggestion: "ok",
				supportedDimensions: [[1284, 2778]],
				valid: true,
			},
		});

		try {
			const code = await runUpload([
				"--app",
				APP_ID,
				"--lang",
				"en-US",
				"--platform",
				"gp",
				"--display-type",
				"phone",
				dir,
			]);
			expect(code).toBe(0);

			const validateCalls = stub.requests.filter((r) =>
				r.url.includes("screenshots/validate"),
			);
			const uploadCalls = stub.requests.filter((r) =>
				r.url.includes("screenshots/upload"),
			);
			// Two files → two validate calls and two upload calls.
			expect(validateCalls.length).toBe(2);
			expect(uploadCalls.length).toBe(2);

			// Every request carries the bearer token from APPBOARD_API_KEY.
			for (const call of [...validateCalls, ...uploadCalls]) {
				expect(call.authorization).toBe("Bearer ab_testkey");
				expect(call.method.toUpperCase()).toBe("POST");
			}

			// Upload body carries the expected multipart fields.
			const uploadBody = uploadCalls[0].body;
			expect(uploadBody).not.toBeNull();
			expect(uploadBody?.get("displayType")).toBe("phone");
			expect(uploadBody?.get("language")).toBe("en-US");
			expect(uploadBody?.get("versionId")).toBe("default");
			expect(uploadBody?.get("file")).toBeInstanceOf(File);
		} finally {
			stub.restore();
		}
	});

	test("validation failure marks file failed, never uploads, exits 1", async () => {
		await writeFile(join(dir, "wrong.png"), await createPng(100, 100));

		const stub = stubFetch({
			"screenshots/upload": { screenshotId: "abc", uploaded: true },
			"screenshots/validate": {
				displayType: "phone",
				displayTypeName: "Android phone",
				providedDimensions: [100, 100],
				suggestion: "Android phone expects 1284x2778; you provided 100x100.",
				supportedDimensions: [[1284, 2778]],
				valid: false,
			},
		});

		try {
			const code = await runUpload([
				"--app",
				APP_ID,
				"--lang",
				"en-US",
				"--platform",
				"gp",
				"--display-type",
				"phone",
				dir,
			]);
			expect(code).toBe(1);

			// Validate was called, upload was NOT.
			expect(
				stub.requests.some((r) => r.url.includes("screenshots/validate")),
			).toBe(true);
			expect(
				stub.requests.some((r) => r.url.includes("screenshots/upload")),
			).toBe(false);
		} finally {
			stub.restore();
		}
	});

	test("apple platform resolves an editable version from the versions endpoint", async () => {
		await writeFile(join(dir, "shot.png"), await createPng(1290, 2796));

		const stub = stubFetch({
			"publishing/versions": {
				source: "live",
				versions: [
					{
						id: "ver-locked",
						isEditable: false,
						state: "PENDING_DEVELOPER_RELEASE",
						versionString: "1.0.0",
					},
					{
						id: "ver-editable",
						isEditable: true,
						state: "PREPARE_FOR_SUBMISSION",
						versionString: "1.1.0",
					},
				],
			},
			"screenshots/upload": { screenshotId: "abc", uploaded: true },
			"screenshots/validate": {
				displayType: "APP_IPHONE_67",
				displayTypeName: 'iPhone 6.7"',
				providedDimensions: [1290, 2796],
				suggestion: "ok",
				supportedDimensions: [[1290, 2796]],
				valid: true,
			},
		});

		try {
			const code = await runUpload([
				"--app",
				APP_ID,
				"--lang",
				"en-US",
				"--platform",
				"apple",
				"--display-type",
				"APP_IPHONE_67",
				dir,
			]);
			expect(code).toBe(0);

			const uploadCall = stub.requests.find((r) =>
				r.url.includes("screenshots/upload"),
			);
			expect(uploadCall?.body?.get("versionId")).toBe("ver-editable");
		} finally {
			stub.restore();
		}
	});
});
