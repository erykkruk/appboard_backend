import { AlternativeStoreProvider } from "@/providers/alternative/base";
import { describeStoreError } from "@/providers/alternative/errors";
import type {
	AppData,
	AssetData,
	ListingData,
	ListingUpdateData,
} from "@/providers/store-provider";
import { createLogger } from "@/utils/logger";
import { agcRequest, getHuaweiToken } from "./client";
import type {
	AgcAppIdListResponse,
	AgcAppInfoResponse,
	HuaweiCredentials,
} from "./types";

const log = createLogger("huawei-provider");

/** 1 = APK. AGC also defines 2 (RPK) and 8 (EXE), which AppBoard does not manage. */
const PACKAGE_TYPE_APK = "1";

/** 1 = release to the entire network (as opposed to 3 = phased release). */
const RELEASE_TYPE_FULL = "1";

/** AGC requires a submission remark of 10-300 characters. */
const SUBMIT_REMARK = "Submitted from AppBoard";

/**
 * Huawei AppGallery Connect provider.
 *
 * Wired through the AGC Connect + Publishing API: per-language listing text
 * (read + write), submission for review, and reading the screenshots already
 * attached to a listing.
 *
 * Two AGC limitations shape this class:
 *  - There is no "list my apps" endpoint. Apps are resolved from package names
 *    kept on the connection (`packageNames`), mirroring how the Google Play
 *    provider falls back to `package_names`.
 *  - Screenshots are read-only. AGC hands out an upload URL, but no documented
 *    endpoint attaches the uploaded object to a listing, so uploads stay
 *    console-only rather than pretending to succeed.
 */
export class HuaweiAppGalleryProvider extends AlternativeStoreProvider {
	private readonly credentials: HuaweiCredentials;

	constructor(credentials: Record<string, unknown>) {
		super("huawei_appgallery");
		this.credentials = credentials as unknown as HuaweiCredentials;
	}

	async validateCredentials(): Promise<{ reason?: string; valid: boolean }> {
		try {
			await getHuaweiToken(this.credentials);
			log.info(
				{ clientId: this.credentials.clientId },
				"Huawei AppGallery credentials validated",
			);
			return { valid: true };
		} catch (err) {
			log.error({ err }, "Huawei AppGallery credentials validation failed");
			return { reason: describeStoreError(err), valid: false };
		}
	}

	/**
	 * AGC resolves apps by package name only, so a connection with no package
	 * names yields nothing — the connect flow then asks the user for them.
	 */
	async fetchApps(): Promise<AppData[]> {
		const packageNames = this.credentials.packageNames ?? [];
		if (packageNames.length === 0) {
			log.info(
				"No package names on the Huawei connection — nothing to resolve",
			);
			return [];
		}

		const apps: AppData[] = [];
		// Queried one at a time: the batch form returns appIds without telling us
		// which package each one belongs to.
		for (const packageName of packageNames) {
			const body = await agcRequest<AgcAppIdListResponse>(
				this.credentials,
				"/appid-list",
				{
					context: "app lookup",
					query: { packageName, packageTypes: PACKAGE_TYPE_APK },
				},
			);
			const match = body.appids?.[0];
			if (!match?.value) {
				log.warn({ packageName }, "Package not found in Huawei AppGallery");
				continue;
			}
			apps.push({
				bundleId: packageName,
				externalId: match.value,
				name: match.key || packageName,
				platform: "android",
			});
		}
		return apps;
	}

	async fetchListings(appId: string): Promise<ListingData[]> {
		const body = await this.getAppInfo(appId);
		return (body.languages ?? []).map((language) => ({
			fullDesc: language.appDesc ?? "",
			language: language.lang,
			shortDesc: language.briefInfo ?? "",
			title: language.appName ?? "",
			whatsNew: language.newFeatures,
		}));
	}

	async updateListing(
		appId: string,
		language: string,
		data: ListingUpdateData,
	): Promise<void> {
		// AGC accepts exactly these five fields on app-language-info.
		const payload: Record<string, string> = { lang: language };
		if (data.title !== undefined) payload.appName = data.title;
		if (data.fullDesc !== undefined) payload.appDesc = data.fullDesc;
		if (data.shortDesc !== undefined) payload.briefInfo = data.shortDesc;
		if (data.whatsNew !== undefined) payload.newFeatures = data.whatsNew;

		await agcRequest(this.credentials, "/app-language-info", {
			body: payload,
			context: "listing update",
			method: "PUT",
			query: { appId, releaseType: RELEASE_TYPE_FULL },
		});
		log.info({ appId, language }, "Huawei AppGallery listing updated");
	}

	async publishListings(appId: string): Promise<void> {
		await agcRequest(this.credentials, "/app-submit", {
			context: "submission",
			method: "POST",
			query: {
				appId,
				releaseType: RELEASE_TYPE_FULL,
				remark: SUBMIT_REMARK,
			},
		});
		log.info({ appId }, "Huawei AppGallery app submitted for review");
	}

	/** Screenshot URLs live on the language info as a comma-separated list. */
	async fetchAssets(appId: string, language: string): Promise<AssetData[]> {
		const body = await this.getAppInfo(appId, language);
		const match = body.languages?.find((entry) => entry.lang === language);
		const urls = (match?.introPic ?? "")
			.split(",")
			.map((url) => url.trim())
			.filter(Boolean);

		return urls.map((url, index) => ({
			assetType: "screenshot",
			deviceType: "phone",
			externalId: `${appId}:${language}:${index}`,
			url,
		}));
	}

	private getAppInfo(
		appId: string,
		language?: string,
	): Promise<AgcAppInfoResponse> {
		return agcRequest<AgcAppInfoResponse>(this.credentials, "/app-info", {
			context: "app info",
			query: { appId, lang: language, releaseType: RELEASE_TYPE_FULL },
		});
	}
}
