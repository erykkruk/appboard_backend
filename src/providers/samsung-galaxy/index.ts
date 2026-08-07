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
import { getSamsungToken, samsungHeaders, samsungRequest } from "./client";
import type {
	SamsungContentInfo,
	SamsungContentListItem,
	SamsungCredentials,
	SamsungFileUploadResponse,
	SamsungLanguageEntry,
	SamsungScreenshotRef,
	SamsungUploadSession,
} from "./types";

const log = createLogger("samsung-provider");

/**
 * Samsung Galaxy Store provider, wired through the Seller Portal Content
 * Publish API: app list, per-language listing text (read + write), screenshot
 * upload, and submission for review.
 *
 * Galaxy Store has no reviews, in-app purchase or age-rating API, so those stay
 * on `AlternativeStoreProvider` and raise a typed error naming the console.
 */
export class SamsungGalaxyProvider extends AlternativeStoreProvider {
	private readonly credentials: SamsungCredentials;

	constructor(credentials: Record<string, unknown>) {
		super("samsung_galaxy");
		this.credentials = credentials as unknown as SamsungCredentials;
	}

	async validateCredentials(): Promise<{ reason?: string; valid: boolean }> {
		try {
			await samsungRequest<SamsungContentListItem[]>(
				this.credentials,
				"/seller/contentList",
				{ context: "app list" },
			);
			log.info(
				{ serviceAccountId: this.credentials.serviceAccountId },
				"Samsung Galaxy Store credentials validated",
			);
			return { valid: true };
		} catch (err) {
			log.error({ err }, "Samsung Galaxy Store credentials validation failed");
			return { reason: describeStoreError(err), valid: false };
		}
	}

	async fetchApps(): Promise<AppData[]> {
		const list = await samsungRequest<SamsungContentListItem[]>(
			this.credentials,
			"/seller/contentList",
			{ context: "app list" },
		);

		return (list ?? []).map((item) => ({
			// Galaxy Store identifies apps by a 12-digit contentId; the Android
			// package name is not exposed by this endpoint.
			bundleId: item.contentId,
			externalId: item.contentId,
			name: item.contentName || item.contentId,
			platform: "android" as const,
		}));
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		const info = await this.getContentInfo(appId);
		const languages = info.addLanguage ?? [];

		if (languages.length === 0 && info.defaultLanguageCode) {
			return [
				{
					fullDesc: info.longDescription ?? "",
					language: info.defaultLanguageCode,
					shortDesc: info.shortDescription ?? "",
					title: info.appTitle ?? "",
					whatsNew: info.newFeature,
				},
			];
		}

		return languages.map((entry) => ({
			fullDesc: entry.description ?? "",
			language: entry.languagecode,
			shortDesc: "",
			title: entry.appTitle ?? "",
			whatsNew: entry.newFeature,
		}));
	}

	async updateListing(
		appId: string,
		language: string,
		data: ListingUpdateData,
	): Promise<void> {
		const info = await this.getContentInfo(appId);
		const languages = [...(info.addLanguage ?? [])];
		const index = languages.findIndex(
			(entry) => entry.languagecode === language,
		);
		const current: SamsungLanguageEntry = languages[index] ?? {
			languagecode: language,
		};

		const updated: SamsungLanguageEntry = {
			...current,
			...(data.title !== undefined ? { appTitle: data.title } : {}),
			...(data.fullDesc !== undefined ? { description: data.fullDesc } : {}),
			...(data.whatsNew !== undefined ? { newFeature: data.whatsNew } : {}),
		};

		if (index >= 0) languages[index] = updated;
		else languages.push(updated);

		await this.contentUpdate(info, { addLanguage: languages });
		log.info({ appId, language }, "Samsung Galaxy Store listing updated");
	}

	async publishListings(appId: string): Promise<void> {
		await samsungRequest(this.credentials, "/seller/contentSubmit", {
			body: { contentId: appId },
			context: "submission",
			method: "POST",
		});
		log.info({ appId }, "Samsung Galaxy Store app submitted for review");
	}

	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		const info = await this.getContentInfo(appId);
		const entry = info.addLanguage?.find((l) => l.languagecode === language);
		const raw = toArray(entry?.screenshots ?? info.screenshots);

		return raw.map((item, index) => ({
			assetType: "screenshot",
			deviceType: "phone",
			externalId: screenshotKeyOf(item) ?? `${appId}:${language}:${index}`,
			url: screenshotUrlOf(item) ?? "",
		}));
	}

	/**
	 * Two-step upload (session → file), then the returned `fileKey` is attached
	 * to the listing. `contentUpdate` replaces the whole screenshot array, so
	 * every existing image must be re-listed with `reuseYn: "Y"` — if any of them
	 * has no resolvable key we abort rather than silently drop it.
	 */
	async uploadAsset(
		appId: string,
		_language: string,
		file: Buffer,
		metadata: AssetMetadata,
	): Promise<AssetData> {
		const info = await this.getContentInfo(appId);
		const existing = toArray(info.screenshots);
		const reused: SamsungScreenshotRef[] = [];

		for (const item of existing) {
			const key = screenshotKeyOf(item);
			if (!key) {
				buildError("storeApiError", {
					info: "Samsung Galaxy Store returned a screenshot without a reusable key, so uploading would drop the existing screenshots. Upload it in Seller Portal instead.",
				});
			}
			reused.push({ reuseYn: "Y", screenshotKey: key });
		}

		const fileKey = await this.uploadFile(file, metadata.fileName);
		await this.contentUpdate(info, {
			screenshots: [...reused, { reuseYn: "N", screenshotKey: fileKey }],
		});

		log.info({ appId, fileKey }, "Samsung Galaxy Store screenshot uploaded");
		return {
			assetType: metadata.assetType,
			deviceType: metadata.deviceType,
			externalId: fileKey,
			url: "",
		};
	}

	private async uploadFile(file: Buffer, fileName?: string): Promise<string> {
		const session = await samsungRequest<SamsungUploadSession>(
			this.credentials,
			"/seller/createUploadSessionId",
			{ context: "upload session", method: "POST" },
		);
		if (!session?.url || !session.sessionId) {
			buildError("storeApiError", {
				info: "Samsung Galaxy Store did not return an upload session.",
			});
		}

		const form = new FormData();
		form.append(
			"file",
			new Blob([new Uint8Array(file)]),
			fileName ?? "screenshot.png",
		);
		form.append("sessionId", session.sessionId);

		const token = await getSamsungToken(this.credentials);
		// The upload host is returned by the session call, not hardcoded, and
		// FormData sets its own multipart boundary.
		const response = await fetch(session.url, {
			body: form,
			headers: samsungHeaders(this.credentials, token),
			method: "POST",
		});

		if (!response.ok) {
			buildError("storeApiError", {
				info: `Samsung Galaxy Store file upload failed (HTTP ${response.status}).`,
			});
		}

		const body = (await response.json()) as SamsungFileUploadResponse;
		if (body.errorCode || !body.fileKey) {
			buildError("storeApiError", {
				info: `Samsung Galaxy Store file upload failed: ${body.errorMsg ?? "no file key returned"}`,
			});
		}
		return body.fileKey;
	}

	/** `contentUpdate` re-sends the mandatory identity fields on every call. */
	private async contentUpdate(
		info: SamsungContentInfo,
		changes: Record<string, unknown>,
	): Promise<void> {
		await samsungRequest(this.credentials, "/seller/contentUpdate", {
			body: {
				appTitle: info.appTitle,
				contentId: info.contentId,
				defaultLanguageCode: info.defaultLanguageCode,
				paid: info.paid,
				publicationType: info.publicationType,
				...changes,
			},
			context: "listing update",
			method: "POST",
		});
	}

	private async getContentInfo(appId: string): Promise<SamsungContentInfo> {
		// contentInfo answers with a single-element array, not an object.
		const result = await samsungRequest<SamsungContentInfo[]>(
			this.credentials,
			"/seller/contentInfo",
			{ context: "app info", query: { contentId: appId } },
		);
		const info = Array.isArray(result) ? result[0] : undefined;
		if (!info) {
			buildError("notFound", {
				info: `Samsung Galaxy Store returned no app for content ID ${appId}.`,
			});
		}
		return info;
	}
}

function toArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function screenshotKeyOf(item: unknown): string | undefined {
	if (typeof item === "string") {
		// A bare URL is not a reusable key.
		return item.startsWith("http") ? undefined : item;
	}
	if (!item || typeof item !== "object") return undefined;
	const record = item as Record<string, unknown>;
	for (const field of ["screenshotKey", "fileKey", "imageKey"]) {
		if (typeof record[field] === "string") return record[field];
	}
	return undefined;
}

function screenshotUrlOf(item: unknown): string | undefined {
	if (typeof item === "string")
		return item.startsWith("http") ? item : undefined;
	if (!item || typeof item !== "object") return undefined;
	const record = item as Record<string, unknown>;
	for (const field of ["imgUrl", "url", "screenshotUrl", "fileName"]) {
		const value = record[field];
		if (typeof value === "string" && value.startsWith("http")) return value;
	}
	return undefined;
}
