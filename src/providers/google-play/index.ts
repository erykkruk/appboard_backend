import {
	getMockAssets,
	getMockListings,
	getMockReviews,
	MOCK_ANDROID_APPS,
} from "@/providers/mock-data";
import type {
	AppData,
	AssetData,
	AssetMetadata,
	ListingData,
	ListingUpdateData,
	ReviewData,
	StoreProvider,
	VersionData,
} from "@/providers/store-provider";
import { createLogger } from "@/utils/logger";
import {
	commitEdit,
	createEdit,
	createGooglePlayClient,
	deleteEdit,
	type GooglePlayClient,
} from "./client";
import {
	DEVICE_TO_IMAGE_TYPE,
	GOOGLE_PLAY_IMAGE_TYPES,
	type GooglePlayCredentials,
	type GooglePlayImageType,
	IMAGE_TYPE_TO_ASSET,
	IMAGE_TYPE_TO_DEVICE,
	isMockCredentials,
} from "./types";

const log = createLogger("google-play");

export class GooglePlayProvider implements StoreProvider {
	private client: GooglePlayClient | null = null;
	private readonly isMock: boolean;

	constructor(private readonly credentials: GooglePlayCredentials) {
		this.isMock = isMockCredentials(credentials);
		if (this.isMock) {
			log.info("Google Play provider initialized in mock mode");
		}
	}

	async createVersion(
		_appId: string,
		_versionString: string,
	): Promise<{ state: string; versionString: string }> {
		// Google Play does not require manual version creation
		return { state: "inProgress", versionString: _versionString };
	}

	async getLatestVersion(_appId: string): Promise<VersionData | null> {
		// Google Play does not have a version concept like App Store
		return null;
	}

	async updateAgeRating(
		_appId: string,
		_appleQuestionnaire: Record<string, string>,
	): Promise<void> {
		// Google Play age ratings are managed via the IARC questionnaire on Play Console
		log.info("Google Play age rating update not supported via API");
	}

	async validateCredentials(): Promise<boolean> {
		if (this.isMock) return true;

		try {
			const client = await this.getClient();

			if (client.packageNames.length === 0) {
				log.warn(
					"No package names configured — credentials accepted but no apps to verify",
				);
				return true;
			}

			// Try to create and immediately discard an edit to verify access
			const packageName = client.packageNames[0];
			const editId = await createEdit(client.api, packageName);
			await deleteEdit(client.api, packageName, editId);

			log.info("Google Play credentials validated successfully");
			return true;
		} catch (err) {
			log.error({ err }, "Google Play credentials validation failed");
			return false;
		}
	}

	async fetchApps(): Promise<AppData[]> {
		if (this.isMock) return MOCK_ANDROID_APPS;

		const client = await this.getClient();

		if (client.packageNames.length === 0) {
			log.warn("No package_names in credentials — cannot discover apps");
			return [];
		}

		const apps: AppData[] = [];

		for (const packageName of client.packageNames) {
			try {
				// Create an edit to read the app details
				const editId = await createEdit(client.api, packageName);

				try {
					const { data: details } = await client.api.edits.details.get({
						editId,
						packageName,
					});

					// Try to get the default listing for the app name
					let appName = packageName;
					try {
						const { data: listingsData } = await client.api.edits.listings.list(
							{
								editId,
								packageName,
							},
						);

						const defaultListing =
							listingsData.listings?.find((l) => l.language === "en-US") ??
							listingsData.listings?.[0];

						if (defaultListing?.title) {
							appName = defaultListing.title;
						}
					} catch {
						log.warn({ packageName }, "Could not fetch listings for app name");
					}

					// Try to fetch app icon
					let iconUrl: string | undefined;
					try {
						const { data: images } = await client.api.edits.images.list({
							editId,
							imageType: "icon",
							language: "en-US",
							packageName,
						});
						const icon = images.images?.[0];
						if (icon?.url) {
							iconUrl = icon.url;
						}
					} catch {
						log.warn({ packageName }, "Could not fetch icon image");
					}

					apps.push({
						bundleId: packageName,
						externalId: packageName,
						iconUrl,
						name: appName,
						platform: "android",
					});
				} finally {
					await deleteEdit(client.api, packageName, editId);
				}
			} catch (err) {
				log.error({ err, packageName }, "Failed to fetch app details");
			}
		}

		log.info({ count: apps.length }, "Fetched apps from Google Play");
		return apps;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		if (this.isMock) return getMockListings(appId);

		const client = await this.getClient();
		const editId = await createEdit(client.api, appId);

		try {
			const { data } = await client.api.edits.listings.list({
				editId,
				packageName: appId,
			});

			const listings: ListingData[] = (data.listings ?? []).map((listing) => ({
				fullDesc: listing.fullDescription ?? "",
				language: listing.language ?? "en-US",
				shortDesc: listing.shortDescription ?? "",
				title: listing.title ?? "",
				// Google Play API v3 does not return video/promo URLs in listings
			}));

			log.info(
				{ appId, count: listings.length },
				"Fetched listings from Google Play",
			);
			return listings;
		} finally {
			await deleteEdit(client.api, appId, editId);
		}
	}

	async updateListing(
		appId: string,
		language: string,
		data: ListingUpdateData,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, language }, "Mock: listing updated");
			return;
		}

		const client = await this.getClient();
		const editId = await createEdit(client.api, appId);

		try {
			// First get the existing listing to merge with updates
			let existingListing: {
				fullDescription?: string | null;
				shortDescription?: string | null;
				title?: string | null;
			} = {};

			try {
				const { data: current } = await client.api.edits.listings.get({
					editId,
					language,
					packageName: appId,
				});
				existingListing = current;
			} catch {
				log.info(
					{ appId, language },
					"No existing listing found, creating new",
				);
			}

			await client.api.edits.listings.update({
				editId,
				language,
				packageName: appId,
				requestBody: {
					fullDescription:
						data.fullDesc ?? existingListing.fullDescription ?? "",
					language,
					shortDescription:
						data.shortDesc ?? existingListing.shortDescription ?? "",
					title: data.title ?? existingListing.title ?? "",
				},
			});

			log.info({ appId, language }, "Listing updated (edit not yet committed)");
			// Note: we do NOT commit here. Call publishListings() to commit.
			// But we must keep the edit alive, so we do NOT delete it.
			// The edit ID needs to be tracked externally or committed immediately.
			// For simplicity in this flow, commit immediately after update.
			await commitEdit(client.api, appId, editId);
			log.info({ appId, language }, "Listing update committed");
		} catch (err) {
			await deleteEdit(client.api, appId, editId);
			throw err;
		}
	}

	async publishListings(appId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId }, "Mock: listings published");
			return;
		}

		// publishListings creates a new edit, applies no changes,
		// and commits it. This is useful if the caller has staged
		// changes through updateListing without committing.
		// However, since updateListing now auto-commits, this is a no-op
		// in the current flow. We keep it for future use when we
		// batch multiple updates into a single edit.
		const client = await this.getClient();
		const editId = await createEdit(client.api, appId);

		try {
			await commitEdit(client.api, appId, editId);
			log.info({ appId }, "Listings published via commit");
		} catch (err) {
			await deleteEdit(client.api, appId, editId);
			throw err;
		}
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		if (this.isMock) return getMockAssets(appId, language);

		const client = await this.getClient();
		const editId = await createEdit(client.api, appId);

		try {
			const assets: AssetData[] = [];

			for (const imageType of GOOGLE_PLAY_IMAGE_TYPES) {
				try {
					const { data } = await client.api.edits.images.list({
						editId,
						imageType,
						language,
						packageName: appId,
					});

					for (const image of data.images ?? []) {
						assets.push({
							assetType: IMAGE_TYPE_TO_ASSET[imageType] ?? imageType,
							deviceType: IMAGE_TYPE_TO_DEVICE[imageType] ?? "phone",
							externalId: image.id ?? "",
							url: image.url ?? "",
						});
					}
				} catch (err) {
					// Some image types may not be available, that is okay
					log.debug(
						{ appId, err, imageType, language },
						"Could not fetch images for type",
					);
				}
			}

			log.info(
				{ appId, count: assets.length, language },
				"Fetched assets from Google Play",
			);
			return assets;
		} finally {
			await deleteEdit(client.api, appId, editId);
		}
	}

	async uploadAsset(
		appId: string,
		language: string,
		file: Buffer,
		metadata: AssetMetadata,
	): Promise<AssetData> {
		if (this.isMock) {
			return {
				assetType: metadata.assetType,
				deviceType: metadata.deviceType,
				externalId: `mock-${Date.now()}`,
				url: "https://placehold.co/1080x1920?text=uploaded",
			};
		}

		const client = await this.getClient();
		const editId = await createEdit(client.api, appId);

		try {
			const imageType = this.resolveImageType(metadata);

			const { data } = await client.api.edits.images.upload({
				editId,
				imageType,
				language,
				media: {
					body: bufferToReadableStream(file),
					mimeType: "image/png",
				},
				packageName: appId,
			});

			const image = data.image;

			await commitEdit(client.api, appId, editId);

			log.info(
				{ appId, imageId: image?.id, imageType, language },
				"Asset uploaded and committed",
			);

			return {
				assetType: metadata.assetType,
				deviceType: metadata.deviceType,
				externalId: image?.id ?? `uploaded-${Date.now()}`,
				url: image?.url ?? "",
			};
		} catch (err) {
			await deleteEdit(client.api, appId, editId);
			throw err;
		}
	}

	async deleteAsset(appId: string, assetId: string): Promise<void> {
		if (this.isMock) {
			log.info({ appId, assetId }, "Mock: asset deleted");
			return;
		}

		const client = await this.getClient();
		const editId = await createEdit(client.api, appId);

		try {
			// We need to find which image type and language this asset belongs to.
			// The assetId format from Google is just a numeric string.
			// We iterate through all image types and languages to find and delete it.
			let deleted = false;

			for (const imageType of GOOGLE_PLAY_IMAGE_TYPES) {
				if (deleted) break;
				try {
					await client.api.edits.images.delete({
						editId,
						imageId: assetId,
						imageType,
						packageName: appId,
					});
					deleted = true;
					log.info({ appId, assetId, imageType }, "Asset deleted");
				} catch {
					// Not found for this image type, try next
				}
			}

			if (!deleted) {
				await deleteEdit(client.api, appId, editId);
				throw new Error(`Asset ${assetId} not found in any image type`);
			}

			await commitEdit(client.api, appId, editId);
		} catch (err) {
			await deleteEdit(client.api, appId, editId);
			throw err;
		}
	}

	async fetchReviews(appId: string): Promise<ReviewData[]> {
		if (this.isMock) return getMockReviews(appId, "google_play");

		const client = await this.getClient();
		const reviews: ReviewData[] = [];

		try {
			const { data } = await client.api.reviews.list({
				packageName: appId,
			});

			for (const review of data.reviews ?? []) {
				const comment = review.comments?.[0]?.userComment;
				const replyComment = review.comments?.[0]?.developerComment;

				if (!comment) continue;

				reviews.push({
					appVersion: comment.appVersionName ?? undefined,
					authorName: review.authorName ?? "Anonymous",
					body: comment.text ?? "",
					device: comment.device ?? undefined,
					externalId: review.reviewId ?? "",
					language: comment.reviewerLanguage ?? undefined,
					osVersion: comment.androidOsVersion
						? `Android ${comment.androidOsVersion}`
						: undefined,
					rating: comment.starRating ?? 0,
					repliedAt: replyComment?.lastModified?.seconds
						? new Date(Number(replyComment.lastModified.seconds) * 1000)
						: undefined,
					replyText: replyComment?.text ?? undefined,
					reviewDate: comment.lastModified?.seconds
						? new Date(Number(comment.lastModified.seconds) * 1000)
						: new Date(),
					territory: comment.reviewerLanguage?.split("-")[1] ?? undefined,
				});
			}

			log.info(
				{ appId, count: reviews.length },
				"Fetched reviews from Google Play",
			);
		} catch (err) {
			log.error({ appId, err }, "Failed to fetch reviews");
			throw err;
		}

		return reviews;
	}

	async replyToReview(
		appId: string,
		reviewId: string,
		text: string,
	): Promise<void> {
		if (this.isMock) {
			log.info({ appId, reviewId }, "Mock: review reply sent");
			return;
		}

		const client = await this.getClient();

		await client.api.reviews.reply({
			packageName: appId,
			requestBody: {
				replyText: text,
			},
			reviewId,
		});

		log.info({ appId, reviewId }, "Review reply sent");
	}

	/** Lazily initializes and returns the Google Play API client */
	private async getClient(): Promise<GooglePlayClient> {
		if (!this.client) {
			this.client = await createGooglePlayClient(this.credentials);
		}
		return this.client;
	}

	/**
	 * Resolves our generic asset metadata to a Google Play image type.
	 * Falls back to phoneScreenshots for unknown types.
	 */
	private resolveImageType(metadata: AssetMetadata): GooglePlayImageType {
		if (metadata.assetType === "featureGraphic") return "featureGraphic";
		if (metadata.assetType === "icon") return "icon";
		if (metadata.assetType === "tvBanner") return "tvBanner";

		// For screenshots, use device type mapping
		const mapped = DEVICE_TO_IMAGE_TYPE[metadata.deviceType];
		return mapped ?? "phoneScreenshots";
	}
}

/**
 * Converts a Buffer to a Readable stream for the googleapis upload API.
 */
function bufferToReadableStream(buffer: Buffer): NodeJS.ReadableStream {
	const { Readable } = require("node:stream");
	const stream = new Readable();
	stream.push(buffer);
	stream.push(null);
	return stream;
}
