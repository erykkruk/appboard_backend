import { createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import type { SamsungAccessTokenResponse, SamsungCredentials } from "./types";

const log = createLogger("samsung-client");

export const SAMSUNG_API_BASE = "https://devapi.samsungapps.com";
const ACCESS_TOKEN_PATH = "/auth/accessToken";

const ALGORITHM = "RS256";
/** Samsung rejects a JWT whose lifetime exceeds 20 minutes. */
const JWT_TTL_SECONDS = 600;

/**
 * The exchanged access token does not expire, but caching it forever would keep
 * a revoked token alive for the life of the process, so it is re-minted daily.
 */
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;

interface CachedToken {
	expiresAtMs: number;
	token: string;
}

const tokenCache = new Map<string, CachedToken>();

function cacheKey(credentials: SamsungCredentials): string {
	const keyFingerprint = createHash("sha256")
		.update(credentials.privateKey)
		.digest("hex")
		.slice(0, 16);
	return `${credentials.serviceAccountId}:${keyFingerprint}`;
}

async function mintJwt(credentials: SamsungCredentials): Promise<string> {
	const secret = await importPKCS8(credentials.privateKey, ALGORITHM);
	const nowSeconds = Math.floor(Date.now() / 1_000);

	return new SignJWT({ scopes: ["publishing"] })
		.setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
		.setIssuer(credentials.serviceAccountId)
		.setIssuedAt(nowSeconds)
		.setExpirationTime(nowSeconds + JWT_TTL_SECONDS)
		.sign(secret);
}

export async function getSamsungToken(
	credentials: SamsungCredentials,
): Promise<string> {
	const key = cacheKey(credentials);
	const cached = tokenCache.get(key);
	if (cached && cached.expiresAtMs > Date.now()) return cached.token;

	const jwt = await mintJwt(credentials);
	const response = await fetch(`${SAMSUNG_API_BASE}${ACCESS_TOKEN_PATH}`, {
		headers: {
			Authorization: `Bearer ${jwt}`,
			"content-type": "application/json",
		},
		method: "POST",
	});

	if (!response.ok) {
		buildError("storeConnectionFailed", {
			info: `Samsung Galaxy Store rejected the access token request (HTTP ${response.status}). Check the service account ID and private key.`,
		});
	}

	const body = (await response.json()) as SamsungAccessTokenResponse;
	if (!body.accessToken) {
		buildError("storeConnectionFailed", {
			info: `Samsung Galaxy Store returned no access token${body.errorMsg ? `: ${body.errorMsg}` : ""}.`,
		});
	}

	tokenCache.set(key, {
		expiresAtMs: Date.now() + ACCESS_TOKEN_TTL_MS,
		token: body.accessToken,
	});
	log.info(
		{ serviceAccountId: credentials.serviceAccountId },
		"Samsung access token minted",
	);
	return body.accessToken;
}

export function invalidateSamsungToken(credentials: SamsungCredentials): void {
	tokenCache.delete(cacheKey(credentials));
}

/** Test seam — the cache is process-wide. */
export function clearSamsungTokenCache(): void {
	tokenCache.clear();
}

/**
 * Samsung reports failures two ways: a gateway-level
 * `{ resultCode, resultMessage }` and a per-operation `errorCode`/`errorMsg`
 * inside an HTTP 200 body. Both have to be checked.
 */
function assertOk(body: unknown, context: string): void {
	if (!body || typeof body !== "object") return;
	const record = body as Record<string, unknown>;

	if (typeof record.resultCode === "string" && record.resultCode !== "0") {
		buildError("storeApiError", {
			info: `Samsung Galaxy Store ${context} failed (${record.resultCode}): ${String(record.resultMessage ?? "unknown error")}`,
		});
	}
	if (record.errorCode) {
		buildError("storeApiError", {
			info: `Samsung Galaxy Store ${context} failed (${String(record.errorCode)}): ${String(record.errorMsg ?? "unknown error")}`,
		});
	}
}

export function samsungHeaders(
	credentials: SamsungCredentials,
	token: string,
): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		"service-account-id": credentials.serviceAccountId,
	};
}

interface SamsungRequestOptions {
	body?: unknown;
	context: string;
	method?: "GET" | "POST";
	query?: Record<string, string>;
}

export async function samsungRequest<T>(
	credentials: SamsungCredentials,
	path: string,
	options: SamsungRequestOptions,
): Promise<T> {
	const token = await getSamsungToken(credentials);
	const url = new URL(`${SAMSUNG_API_BASE}${path}`);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		url.searchParams.set(key, value);
	}

	const headers: Record<string, string> = samsungHeaders(credentials, token);
	if (options.body !== undefined) headers["content-type"] = "application/json";

	const response = await fetch(url.toString(), {
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		headers,
		method: options.method ?? "GET",
	});

	if (response.status === 401 || response.status === 403) {
		invalidateSamsungToken(credentials);
		buildError("storeConnectionFailed", {
			info: `Samsung Galaxy Store denied the ${options.context} request (HTTP ${response.status}). The service account may lack access to this app.`,
		});
	}
	if (!response.ok) {
		buildError("storeApiError", {
			info: `Samsung Galaxy Store ${options.context} failed (HTTP ${response.status}).`,
		});
	}

	// contentSubmit answers 204 with no body.
	if (response.status === 204) return undefined as T;

	const text = await response.text();
	if (!text) return undefined as T;

	const parsed = JSON.parse(text) as T;
	assertOk(parsed, options.context);
	return parsed;
}
