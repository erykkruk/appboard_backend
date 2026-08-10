import { createHash } from "node:crypto";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import type { AmazonCredentials, AmazonTokenResponse } from "./types";

const log = createLogger("amazon-client");

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const LWA_SCOPE = "appstore::apps:readwrite";
export const AMAZON_API_BASE = "https://developer.amazon.com/api/appstore/v1";

/** Re-mint slightly before expiry so an in-flight request can't race it. */
const REFRESH_MARGIN_MS = 60 * 1_000;

interface CachedToken {
	expiresAtMs: number;
	token: string;
}

const tokenCache = new Map<string, CachedToken>();

function cacheKey(credentials: AmazonCredentials): string {
	const secretFingerprint = createHash("sha256")
		.update(credentials.clientSecret)
		.digest("hex")
		.slice(0, 16);
	return `${credentials.clientId}:${secretFingerprint}`;
}

export async function getAmazonToken(
	credentials: AmazonCredentials,
): Promise<string> {
	const key = cacheKey(credentials);
	const cached = tokenCache.get(key);
	if (cached && cached.expiresAtMs > Date.now() + REFRESH_MARGIN_MS) {
		return cached.token;
	}

	const response = await fetch(LWA_TOKEN_URL, {
		body: new URLSearchParams({
			client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
			grant_type: "client_credentials",
			scope: LWA_SCOPE,
		}),
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		method: "POST",
	});

	if (!response.ok) {
		buildError("storeConnectionFailed", {
			info: `Login with Amazon rejected the token request (HTTP ${response.status}). Check the security profile's client ID and client secret, and that it is allow-listed for the App Submission API.`,
		});
	}

	const body = (await response.json()) as AmazonTokenResponse;
	if (!body.access_token) {
		buildError("storeConnectionFailed", {
			info: "Login with Amazon returned no access token.",
		});
	}

	tokenCache.set(key, {
		expiresAtMs: Date.now() + (body.expires_in ?? 3_600) * 1_000,
		token: body.access_token,
	});
	log.info({ clientId: credentials.clientId }, "Amazon LWA token minted");
	return body.access_token;
}

export function invalidateAmazonToken(credentials: AmazonCredentials): void {
	tokenCache.delete(cacheKey(credentials));
}

/** Test seam — the cache is process-wide. */
export function clearAmazonTokenCache(): void {
	tokenCache.clear();
}

export interface AmazonResponse<T> {
	/** Concurrency token; every mutating call must echo it back as `If-Match`. */
	etag: string | null;
	body: T;
}

interface AmazonRequestOptions {
	body?: unknown;
	/** Raw binary body for image uploads (sent as application/octet-stream). */
	binary?: Buffer;
	context: string;
	etag?: string | null;
	method?: "DELETE" | "GET" | "POST" | "PUT";
}

/**
 * One authenticated App Submission API call, rooted at an app.
 *
 * Amazon guards every mutation with an ETag: you GET a resource, read its
 * `ETag` header, and send it back as `If-Match`. A 412 does not mean a stale
 * tag — it means the app is currently pending or in review.
 */
export async function amazonRequest<T>(
	credentials: AmazonCredentials,
	appId: string,
	path: string,
	options: AmazonRequestOptions,
): Promise<AmazonResponse<T>> {
	const token = await getAmazonToken(credentials);
	const url = `${AMAZON_API_BASE}/applications/${encodeURIComponent(appId)}${path}`;

	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
	};
	if (options.etag) headers["If-Match"] = options.etag;
	if (options.binary) headers["Content-Type"] = "application/octet-stream";
	else if (options.body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const response = await fetch(url, {
		body: options.binary
			? new Uint8Array(options.binary)
			: options.body === undefined
				? undefined
				: JSON.stringify(options.body),
		headers,
		method: options.method ?? "GET",
	});

	if (response.status === 401 || response.status === 403) {
		invalidateAmazonToken(credentials);
		buildError("storeConnectionFailed", {
			info: `Amazon Appstore denied the ${options.context} request (HTTP ${response.status}). The security profile may not have access to this app.`,
		});
	}
	if (response.status === 412) {
		buildError("storeApiError", {
			info: `Amazon Appstore rejected the ${options.context}: the app is currently pending or in review, so its listing cannot be edited.`,
		});
	}
	if (!response.ok) {
		buildError("storeApiError", {
			info: `Amazon Appstore ${options.context} failed (HTTP ${response.status}): ${await readAmazonMessage(response)}`,
		});
	}

	const etag = response.headers.get("ETag");
	const text = await response.text();
	return {
		body: (text ? JSON.parse(text) : undefined) as T,
		etag,
	};
}

async function readAmazonMessage(response: Response): Promise<string> {
	try {
		const text = await response.text();
		if (!text) return "no details returned";
		const parsed = JSON.parse(text) as { message?: string };
		return parsed.message ?? text.slice(0, 200);
	} catch {
		return "no details returned";
	}
}
