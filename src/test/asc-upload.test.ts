import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import type {
	ApiClient,
	ApiResourceWithLinks,
} from "node-app-store-connect-api";
import { uploadAndCommitAsset } from "@/providers/app-store/asc-upload";

const originalFetch = globalThis.fetch;

const BYTES = Buffer.from("fake-screenshot-bytes");
const EXPECTED_MD5 = createHash("md5").update(BYTES).digest("hex");

function reservation(): ApiResourceWithLinks {
	return {
		attributes: {
			uploadOperations: [
				{
					length: BYTES.length,
					method: "PUT",
					offset: 0,
					requestHeaders: [{ name: "Content-Type", value: "image/png" }],
					url: "https://upload.apple.com/part-1",
				},
			],
		},
		id: "screenshot-1",
		type: "appScreenshots",
	};
}

/**
 * Fake ASC client. `states` is the sequence of assetDeliveryState values the
 * poll will observe, one per read.
 */
function fakeClient(states: Array<string | "throw">) {
	const removed: string[] = [];
	const committed: Array<Record<string, unknown>> = [];
	let read = 0;

	const client = {
		fetchJson: async () => {
			const state = states[Math.min(read, states.length - 1)];
			read++;
			if (state === "throw") throw new Error("503 from Apple");
			return { attributes: { assetDeliveryState: { errors: [], state } } };
		},
		remove: async (data: { id: string }) => {
			removed.push(data.id);
		},
		update: async (
			_data: ApiResourceWithLinks,
			options: { attributes?: Record<string, unknown> },
		) => {
			committed.push(options.attributes ?? {});
			return {} as never;
		},
	} as unknown as ApiClient;

	return { client, committed, removed };
}

describe("App Store Connect asset upload", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function stubUpload(status = 200) {
		globalThis.fetch = (async () =>
			new Response("", { status })) as unknown as typeof fetch;
	}

	it("commits with the MD5 checksum of the source file", async () => {
		stubUpload();
		const { client, committed } = fakeClient(["COMPLETE"]);

		const result = await uploadAndCommitAsset(client, reservation(), BYTES);

		expect(result.sourceFileChecksum).toBe(EXPECTED_MD5);
		expect(committed[0]).toEqual({
			sourceFileChecksum: EXPECTED_MD5,
			uploaded: true,
		});
	});

	it("keeps a screenshot that is still processing when the poll window runs out", async () => {
		stubUpload();
		// Apple never leaves UPLOAD_COMPLETE within the window — slow queue, not failure.
		const { client, removed } = fakeClient(["UPLOAD_COMPLETE"]);

		await uploadAndCommitAsset(client, reservation(), BYTES, "screenshot", {
			intervalMs: 1,
			maxAttempts: 3,
		});

		// Deleting here would destroy a screenshot that uploaded perfectly.
		expect(removed).toEqual([]);
	});

	it("keeps the asset when the delivery state cannot be read", async () => {
		stubUpload();
		const { client, removed } = fakeClient(["throw"]);

		await uploadAndCommitAsset(client, reservation(), BYTES, "screenshot", {
			intervalMs: 1,
			maxAttempts: 5,
		});

		expect(removed).toEqual([]);
	});

	it("discards the asset only when Apple rejects the bytes", async () => {
		stubUpload();
		const { client, removed } = fakeClient(["FAILED"]);

		await expect(
			uploadAndCommitAsset(client, reservation(), BYTES),
		).rejects.toThrow("rejected by Apple");

		expect(removed).toEqual(["screenshot-1"]);
	});

	it("discards the reservation when the bytes never upload", async () => {
		stubUpload(500);
		const { client, removed, committed } = fakeClient(["COMPLETE"]);

		await expect(
			uploadAndCommitAsset(client, reservation(), BYTES),
		).rejects.toThrow();

		// Nothing was committed, so the empty reservation must not linger in the set.
		expect(committed).toEqual([]);
		expect(removed).toEqual(["screenshot-1"]);
	}, 30_000);
});
