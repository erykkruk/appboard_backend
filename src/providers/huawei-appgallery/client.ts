import { createHash } from "node:crypto";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import type { AgcRet, AgcTokenResponse, HuaweiCredentials } from "./types";

const log = createLogger("huawei-client");

const TOKEN_URL = "https://connect-api.cloud.huawei.com/api/oauth2/v1/token";
export const AGC_API_BASE =
	"https://connect-api.cloud.huawei.com/api/publish/v2";

/** AGC tokens last 48h; re-mint a few minutes early so no request races expiry. */
const REFRESH_MARGIN_MS = 5 * 60 * 1_000;

interface CachedToken {
	expiresAtMs: number;
	token: string;
}

const tokenCache = new Map<string, CachedToken>();

function cacheKey(credentials: HuaweiCredentials): string {
	const secretFingerprint = createHash("sha256")
		.update(credentials.clientSecret)
		.digest("hex")
		.slice(0, 16);
	return `${credentials.clientId}:${secretFingerprint}`;
}

/**
 * AGC signals failures with HTTP 200 and a non-zero `ret.code`, so status codes
 * alone never tell us whether a call worked.
 */
function assertOk(ret: AgcRet | undefined, context: string): void {
	if (!ret || ret.code === 0) return;
	buildError("storeApiError", {
		info: `Huawei AppGallery ${context} failed (${ret.code}): ${ret.msg ?? "unknown error"}`,
	});
}

export async function getHuaweiToken(
	credentials: HuaweiCredentials,
): Promise<string> {
	const key = cacheKey(credentials);
	const cached = tokenCache.get(key);
	if (cached && cached.expiresAtMs > Date.now() + REFRESH_MARGIN_MS) {
		return cached.token;
	}

	const response = await fetch(TOKEN_URL, {
		body: JSON.stringify({
			client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
			grant_type: "client_credentials",
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});

	if (!response.ok) {
		buildError("storeConnectionFailed", {
			info: `Huawei AppGallery rejected the token request (HTTP ${response.status}). Check the client ID and client secret.`,
		});
	}

	const body = (await response.json()) as AgcTokenResponse;
	assertOk(body.ret, "token request");

	if (!body.access_token) {
		buildError("storeConnectionFailed", {
			info: "Huawei AppGallery returned no access token. Check the client ID and client secret.",
		});
	}

	const ttlMs = (body.expires_in ?? 3_600) * 1_000;
	tokenCache.set(key, {
		expiresAtMs: Date.now() + ttlMs,
		token: body.access_token,
	});
	log.info({ clientId: credentials.clientId }, "Huawei AGC token minted");
	return body.access_token;
}

export function invalidateHuaweiToken(credentials: HuaweiCredentials): void {
	tokenCache.delete(cacheKey(credentials));
}

/** Test seam — the cache is process-wide. */
export function clearHuaweiTokenCache(): void {
	tokenCache.clear();
}

interface AgcRequestOptions {
	body?: unknown;
	context: string;
	method?: "DELETE" | "GET" | "POST" | "PUT";
	query?: Record<string, string | undefined>;
}

/**
 * One authenticated AGC call. Both the bearer token and the `client_id` header
 * are required on every publishing endpoint.
 */
export async function agcRequest<T extends { ret?: AgcRet }>(
	credentials: HuaweiCredentials,
	path: string,
	options: AgcRequestOptions,
): Promise<T> {
	const token = await getHuaweiToken(credentials);
	const url = new URL(`${AGC_API_BASE}${path}`);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		if (value !== undefined) url.searchParams.set(key, value);
	}

	const response = await fetch(url.toString(), {
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			client_id: credentials.clientId,
		},
		method: options.method ?? "GET",
	});

	if (response.status === 401 || response.status === 403) {
		// The cached token may have been revoked in the console.
		invalidateHuaweiToken(credentials);
		buildError("storeConnectionFailed", {
			info: `Huawei AppGallery denied the ${options.context} request (HTTP ${response.status}). The API client may lack permission for this app.`,
		});
	}
	if (!response.ok) {
		buildError("storeApiError", {
			info: `Huawei AppGallery ${options.context} failed (HTTP ${response.status}).`,
		});
	}

	const body = (await response.json()) as T;
	assertOk(body.ret, options.context);
	return body;
}
