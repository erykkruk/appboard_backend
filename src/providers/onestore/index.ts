import { AlternativeStoreProvider } from "@/providers/alternative/base";
import { describeStoreError } from "@/providers/alternative/errors";
import type { AppData } from "@/providers/store-provider";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("onestore-provider");

const ONESTORE_TOKEN_URL = "https://iap-apis.onestore.net/v7/oauth/token";

/** Domestic (Korean) market. `MKT_GLB` is the global equivalent. */
const MARKET_CODE = "MKT_ONE";

/** Credentials pasted in the panel: Developer Center → app → In-App → Credentials. */
export interface OneStoreCredentials {
	clientId: string;
	clientSecret: string;
}

interface OneStoreTokenResponse {
	access_token?: string;
	error?: { code?: string; message?: string };
	expires_in?: number;
}

/**
 * ONE Store provider.
 *
 * ONE Store publishes **no** app-submission API. Its documented "v7 API" is the
 * In-App Purchase Server API; app registration, metadata and screenshots are
 * handled exclusively in the ONE Store Developer Center console.
 *
 * So this provider only proves the credentials work (via the documented v7
 * OAuth handshake) and stores them. Every listing, asset and publishing call
 * raises a typed error pointing at the console rather than pretending to work.
 */
export class OneStoreProvider extends AlternativeStoreProvider {
	private readonly credentials: OneStoreCredentials;

	constructor(credentials: Record<string, unknown>) {
		super("onestore");
		this.credentials = credentials as unknown as OneStoreCredentials;
	}

	async validateCredentials(): Promise<{ reason?: string; valid: boolean }> {
		try {
			const response = await fetch(ONESTORE_TOKEN_URL, {
				body: new URLSearchParams({
					client_id: this.credentials.clientId,
					client_secret: this.credentials.clientSecret,
					grant_type: "client_credentials",
				}),
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"x-market-code": MARKET_CODE,
				},
				method: "POST",
			});

			if (!response.ok) {
				buildError("storeConnectionFailed", {
					info: `ONE Store rejected the token request (HTTP ${response.status}). Check the client ID and client secret from Developer Center.`,
				});
			}

			const body = (await response.json()) as OneStoreTokenResponse;
			if (!body.access_token) {
				buildError("storeConnectionFailed", {
					info: `ONE Store returned no access token${body.error?.message ? `: ${body.error.message}` : ""}.`,
				});
			}

			log.info(
				{ clientId: this.credentials.clientId },
				"ONE Store credentials validated",
			);
			return { valid: true };
		} catch (err) {
			log.error({ err }, "ONE Store credentials validation failed");
			return { reason: describeStoreError(err), valid: false };
		}
	}

	/** ONE Store exposes no endpoint that enumerates a developer's apps. */
	async fetchApps(): Promise<AppData[]> {
		log.info("ONE Store has no app list API — add apps in Developer Center");
		return [];
	}
}
