import { AlternativeStoreProvider } from "@/providers/alternative/base";
import { describeStoreError } from "@/providers/alternative/errors";
import type {
	AppData,
	AssetData,
	AssetMetadata,
	ListingData,
	ListingUpdateData,
} from "@/providers/store-provider";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { amazonRequest, getAmazonToken } from "./client";
import type {
	AmazonAssetResource,
	AmazonCredentials,
	AmazonEdit,
	AmazonListing,
	AmazonListingsResponse,
} from "./types";

const log = createLogger("amazon-provider");

/** The App Submission API image bucket AppBoard manages. */
const IMAGE_TYPE_SCREENSHOTS = "screenshots";

/**
 * Amazon Appstore provider, wired through the App Submission API.
 *
 * Everything happens inside an "edit" — a draft of the app that is created,
 * modified, then committed. Reads therefore open (or reuse) an edit too, and
 * every mutation carries the resource's ETag as `If-Match`.
 *
 * Amazon exposes no endpoint that lists a developer's apps, so package names
 * live on the connection, the same way the Huawei provider resolves apps.
 */
export class AmazonAppstoreProvider extends AlternativeStoreProvider {
	private readonly credentials: AmazonCredentials;

	constructor(credentials: Record<string, unknown>) {
		super("amazon_appstore");
		this.credentials = credentials as unknown as AmazonCredentials;
	}

	async validateCredentials(): Promise<{ reason?: string; valid: boolean }> {
		try {
			await getAmazonToken(this.credentials);
			log.info(
				{ clientId: this.credentials.clientId },
				"Amazon Appstore credentials validated",
			);
			return { valid: true };
		} catch (err) {
			log.error({ err }, "Amazon Appstore credentials validation failed");
			return { reason: describeStoreError(err), valid: false };
		}
	}

	async fetchApps(): Promise<AppData[]> {
		const packageNames = this.credentials.packageNames ?? [];
		if (packageNames.length === 0) {
			log.info(
				"No package names on the Amazon connection — nothing to resolve",
			);
			return [];
		}

		const apps: AppData[] = [];
		for (const packageName of packageNames) {
			try {
				// Resolving an edit both proves access and yields the listing title.
				const listings = await this.getListings(packageName);
				apps.push({
					bundleId: packageName,
					externalId: packageName,
					name: listings[0]?.title || packageName,
					platform: "android",
				});
			} catch (err) {
				log.warn(
					{ err, packageName },
					"Package not accessible in Amazon Appstore",
				);
			}
		}
		return apps;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		const listings = await this.getListings(appId);
		return listings.map((listing) => ({
			fullDesc: listing.fullDescription ?? "",
			keywords: listing.keywords?.join(", "),
			language: listing.language,
			shortDesc: listing.shortDescription ?? "",
			title: listing.title ?? "",
			whatsNew: listing.recentChanges,
		}));
	}

	async updateListing(
		appId: string,
		language: string,
		data: ListingUpdateData,
	): Promise<void> {
		const editId = await this.getOrCreateEdit(appId);
		const path = `/edits/${editId}/listings/${encodeURIComponent(language)}`;

		// Read first: the PUT replaces the resource and needs its ETag.
		const current = await amazonRequest<AmazonListing>(
			this.credentials,
			appId,
			path,
			{ context: "listing read" },
		);

		const payload: AmazonListing = {
			...current.body,
			language,
			...(data.title !== undefined ? { title: data.title } : {}),
			...(data.fullDesc !== undefined
				? { fullDescription: data.fullDesc }
				: {}),
			...(data.shortDesc !== undefined
				? { shortDescription: data.shortDesc }
				: {}),
			...(data.whatsNew !== undefined ? { recentChanges: data.whatsNew } : {}),
			...(data.keywords !== undefined
				? { keywords: splitKeywords(data.keywords) }
				: {}),
		};

		await amazonRequest(this.credentials, appId, path, {
			body: payload,
			context: "listing update",
			etag: current.etag,
			method: "PUT",
		});
		log.info({ appId, language }, "Amazon Appstore listing updated");
	}

	/** Committing the edit is what submits the app for review. */
	async publishListings(appId: string): Promise<void> {
		const editId = await this.getOrCreateEdit(appId);
		const edit = await amazonRequest<AmazonEdit>(
			this.credentials,
			appId,
			`/edits/${editId}`,
			{ context: "edit read" },
		);

		await amazonRequest(this.credentials, appId, `/edits/${editId}/commit`, {
			context: "edit commit",
			etag: edit.etag,
			method: "POST",
		});
		log.info({ appId, editId }, "Amazon Appstore edit committed");
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		const editId = await this.getOrCreateEdit(appId);
		const result = await amazonRequest<AmazonAssetResource>(
			this.credentials,
			appId,
			this.imagePath(editId, language),
			{ context: "screenshot list" },
		);

		const images = result.body?.images ?? [];
		return images.map((image) => ({
			assetType: "screenshot",
			deviceType: "phone",
			externalId: image.id,
			// The API returns asset ids only; it exposes no public image URL.
			url: "",
		}));
	}

	async uploadAsset(
		appId: string,
		language: string,
		file: Buffer,
		metadata: AssetMetadata,
	): Promise<AssetData> {
		const editId = await this.getOrCreateEdit(appId);
		const path = this.imagePath(editId, language);

		const current = await amazonRequest<AmazonAssetResource>(
			this.credentials,
			appId,
			path,
			{ context: "screenshot list" },
		);

		const result = await amazonRequest<AmazonAssetResource>(
			this.credentials,
			appId,
			`${path}/upload`,
			{
				binary: file,
				context: "screenshot upload",
				etag: current.etag,
				method: "POST",
			},
		);

		const id = result.body?.image?.id;
		if (!id) {
			buildError("storeApiError", {
				info: "Amazon Appstore returned no asset id for the uploaded screenshot.",
			});
		}

		log.info({ appId, id, language }, "Amazon Appstore screenshot uploaded");
		return {
			assetType: metadata.assetType,
			deviceType: metadata.deviceType,
			externalId: id,
			url: "",
		};
	}

	async deleteAsset(appId: string, assetId: string): Promise<void> {
		const editId = await this.getOrCreateEdit(appId);
		// Amazon scopes assets per language; the id alone is unambiguous only
		// within one, so the default-language bucket is used.
		const listings = await this.getListings(appId);
		const language = listings[0]?.language;
		if (!language) {
			buildError("storeApiError", {
				info: "Amazon Appstore has no listing language to delete this screenshot from.",
			});
		}

		const path = this.imagePath(editId, language);
		const current = await amazonRequest<AmazonAssetResource>(
			this.credentials,
			appId,
			path,
			{ context: "screenshot list" },
		);

		await amazonRequest(
			this.credentials,
			appId,
			`${path}/${encodeURIComponent(assetId)}`,
			{ context: "screenshot delete", etag: current.etag, method: "DELETE" },
		);
		log.info({ appId, assetId }, "Amazon Appstore screenshot deleted");
	}

	private imagePath(editId: string, language: string): string {
		return `/edits/${editId}/listings/${encodeURIComponent(language)}/${IMAGE_TYPE_SCREENSHOTS}`;
	}

	private async getListings(appId: string): Promise<AmazonListing[]> {
		const editId = await this.getOrCreateEdit(appId);
		const result = await amazonRequest<AmazonListingsResponse>(
			this.credentials,
			appId,
			`/edits/${editId}/listings`,
			{ context: "listing read" },
		);
		return normalizeListings(result.body);
	}

	/**
	 * Listings only exist inside an edit, so reads open one too. An app with no
	 * open edit gets a fresh draft — which is exactly how the console behaves.
	 */
	private async getOrCreateEdit(appId: string): Promise<string> {
		const active = await amazonRequest<AmazonEdit | undefined>(
			this.credentials,
			appId,
			"/edits",
			{ context: "active edit lookup" },
		);
		if (active.body?.id) return active.body.id;

		const created = await amazonRequest<AmazonEdit>(
			this.credentials,
			appId,
			"/edits",
			{ context: "edit creation", method: "POST" },
		);
		if (!created.body?.id) {
			buildError("storeApiError", {
				info: "Amazon Appstore did not return an edit id.",
			});
		}
		log.info({ appId, editId: created.body.id }, "Amazon Appstore edit opened");
		return created.body.id;
	}
}

function normalizeListings(body: AmazonListingsResponse | undefined) {
	const listings = body?.listings;
	if (!listings) return [];
	if (Array.isArray(listings)) return listings;
	// The spec keys listings by language code.
	return Object.entries(listings).map(([language, listing]) => ({
		...listing,
		language: listing.language ?? language,
	}));
}

function splitKeywords(keywords: string): string[] {
	return keywords
		.split(",")
		.map((keyword) => keyword.trim())
		.filter(Boolean);
}
