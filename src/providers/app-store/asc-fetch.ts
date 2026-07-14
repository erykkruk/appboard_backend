import {
	computeBackoffMs,
	isRetryableStatus,
	nextDelayMs,
	sleep,
} from "@/utils/backoff";
import { createLogger } from "@/utils/logger";
import { getAscToken, invalidateAscToken } from "./asc-token";
import type { AppStoreApiCredentials } from "./types";

const log = createLogger("app-store-fetch");

export const ASC_URL_BASE = "https://api.appstoreconnect.apple.com";

/** Total attempts per request, including the first one. */
const MAX_ATTEMPTS = 6;

export type AscFetch = (
	url: string,
	options?: RequestInit,
) => Promise<Response>;

/**
 * The fetch implementation handed to `node-app-store-connect-api`.
 *
 * It replaces two behaviours of the library that are actively harmful:
 *
 * 1. Auth — the library signs one JWT per client and never refreshes it. We
 *    stamp every App Store Connect request with a cached token instead, and
 *    re-mint on a 401 rather than replaying the rejected token.
 * 2. Retries — the library re-fires 401/429/500 up to 11 times with *no* delay,
 *    which hammers Apple precisely while it is throttling us. We back off
 *    exponentially and honour `Retry-After`.
 *
 * Asset upload URLs (pre-signed, non-ASC hosts) pass through unauthenticated —
 * Apple's docs are explicit that they must not carry a JWT — but still get the
 * retry/backoff treatment.
 */
export function createAscFetch(credentials: AppStoreApiCredentials): AscFetch {
	return async function ascFetch(url, options) {
		const isAscRequest = url.startsWith(ASC_URL_BASE);
		let refreshedToken = false;

		for (let attempt = 1; ; attempt++) {
			const requestOptions: RequestInit = { ...options };

			if (isAscRequest) {
				const headers = new Headers(options?.headers);
				headers.set(
					"Authorization",
					`Bearer ${await getAscToken(credentials)}`,
				);
				requestOptions.headers = headers;
			}

			let response: Response;
			try {
				response = await fetch(url, requestOptions);
			} catch (err) {
				if (attempt >= MAX_ATTEMPTS) throw err;
				const delay = computeBackoffMs(attempt);
				log.warn({ attempt, delay, err, url }, "Network error, retrying");
				await sleep(delay);
				continue;
			}

			// A token we believed was fresh was rejected — re-mint once and replay.
			if (response.status === 401 && isAscRequest && !refreshedToken) {
				refreshedToken = true;
				invalidateAscToken(credentials);
				log.warn({ url }, "App Store Connect rejected token, re-minting");
				continue;
			}

			if (!isRetryableStatus(response.status) || attempt >= MAX_ATTEMPTS) {
				return response;
			}

			const delay = nextDelayMs(attempt, response.headers.get("retry-after"));
			log.warn(
				{ attempt, delay, status: response.status, url },
				"App Store Connect request failed, backing off",
			);
			await sleep(delay);
		}
	};
}
