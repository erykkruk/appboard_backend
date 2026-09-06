import { describe, expect, it } from "bun:test";
import type { androidpublisher_v3 } from "googleapis";
import { GooglePlayProvider } from "@/providers/google-play";
import type { GooglePlayClient } from "@/providers/google-play/client";

interface ListingRequest {
	fullDescription?: string | null;
	language?: string | null;
	shortDescription?: string | null;
	title?: string | null;
	video?: string | null;
}

/**
 * Fake androidpublisher serving one existing listing and recording every
 * listing body we send back to Play.
 */
function fakeClient(existing: ListingRequest) {
	const updates: ListingRequest[] = [];

	const api = {
		edits: {
			commit: async () => ({ data: {} }),
			delete: async () => ({ data: {} }),
			insert: async () => ({ data: { id: "edit-1" } }),
			listings: {
				get: async () => ({ data: existing }),
				list: async () => ({ data: { listings: [existing] } }),
				update: async ({ requestBody }: { requestBody: ListingRequest }) => {
					updates.push(requestBody);
					return { data: requestBody };
				},
			},
		},
	} as unknown as androidpublisher_v3.Androidpublisher;

	const client: GooglePlayClient = {
		api,
		auth: {} as GooglePlayClient["auth"],
		packageNames: ["com.example.app"],
	};

	return { client, updates };
}

/** Inject a canned client so no request ever leaves the process. */
function providerWith(client: GooglePlayClient): GooglePlayProvider {
	const provider = new GooglePlayProvider({
		client_email: "svc@example.com",
		private_key: "not-a-real-key",
		project_id: "example",
	});
	(provider as unknown as { client: GooglePlayClient }).client = client;
	return provider;
}

const EXISTING = {
	fullDescription: "Full description",
	language: "en-US",
	shortDescription: "Short description",
	title: "Existing title",
	video: "https://youtube.com/watch?v=existing",
};

describe("Google Play promo video", () => {
	it("reads the promo video into videoUrl", async () => {
		const { client } = fakeClient(EXISTING);

		const listings =
			await providerWith(client).fetchListings("com.example.app");

		expect(listings).toHaveLength(1);
		expect(listings[0].videoUrl).toBe("https://youtube.com/watch?v=existing");
	});

	it("keeps the existing promo video when the draft has none", async () => {
		const { client, updates } = fakeClient(EXISTING);

		// Publishing only the title used to send an empty `video`, which wipes the
		// promo video the user set in Play Console.
		await providerWith(client).updateListing("com.example.app", "en-US", {
			title: "New title",
		});

		expect(updates).toHaveLength(1);
		expect(updates[0].title).toBe("New title");
		expect(updates[0].video).toBe("https://youtube.com/watch?v=existing");
	});

	it("writes the draft promo video when one is set", async () => {
		const { client, updates } = fakeClient(EXISTING);

		await providerWith(client).updateListing("com.example.app", "en-US", {
			videoUrl: "https://youtube.com/watch?v=new",
		});

		expect(updates[0].video).toBe("https://youtube.com/watch?v=new");
	});

	it("keeps the existing promo video in a batch publish", async () => {
		const { client, updates } = fakeClient(EXISTING);

		await providerWith(client).batchPublishListings("com.example.app", [
			{ data: { shortDesc: "Updated short" }, language: "en-US" },
		]);

		expect(updates).toHaveLength(1);
		expect(updates[0].shortDescription).toBe("Updated short");
		expect(updates[0].video).toBe("https://youtube.com/watch?v=existing");
	});

	it("falls back to an empty video when the store has none either", async () => {
		const { client, updates } = fakeClient({
			...EXISTING,
			video: null,
		});

		await providerWith(client).updateListing("com.example.app", "en-US", {
			title: "New title",
		});

		expect(updates[0].video).toBe("");
	});
});
