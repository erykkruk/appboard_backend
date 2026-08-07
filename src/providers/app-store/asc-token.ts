import { createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import type { AppStoreApiCredentials } from "./types";

/**
 * Cached ES256 bearer tokens for the App Store Connect API.
 *
 * The `node-app-store-connect-api` package mints one token per client instance
 * and never refreshes it, while we build a fresh client on almost every service
 * call — so a publish run used to re-sign a JWT dozens of times, and any client
 * kept alive past the token lifetime started failing with 401s.
 *
 * We mint here instead, cache per credential, and hand the token to the library
 * through a custom fetch (see `asc-fetch.ts`).
 */

const ALGORITHM = "ES256";
const AUDIENCE = "appstoreconnect-v1";

/**
 * Apple accepts at most 20 minutes. fastlane deliberately signs much shorter
 * tokens (500s) because tokens close to the cap get rejected when the local
 * clock drifts ahead of Apple's.
 */
const TOKEN_TTL_SECONDS = 500;

/** Backdate `iat` to survive a local clock that runs slightly fast. */
const CLOCK_SKEW_SECONDS = 60;

/** Re-mint slightly before expiry so an in-flight request can't race it. */
const REFRESH_MARGIN_SECONDS = 30;

interface CachedToken {
	expiresAtMs: number;
	token: string;
}

const tokenCache = new Map<string, CachedToken>();

function cacheKey(credentials: AppStoreApiCredentials): string {
	const keyFingerprint = createHash("sha256")
		.update(credentials.privateKey)
		.digest("hex")
		.slice(0, 16);
	return `${credentials.issuerId}:${credentials.keyId}:${keyFingerprint}`;
}

async function mintToken(credentials: AppStoreApiCredentials): Promise<string> {
	const secret = await importPKCS8(credentials.privateKey, ALGORITHM);
	const nowSeconds = Math.floor(Date.now() / 1_000);

	return new SignJWT({})
		.setProtectedHeader({ alg: ALGORITHM, kid: credentials.keyId, typ: "JWT" })
		.setIssuedAt(nowSeconds - CLOCK_SKEW_SECONDS)
		.setIssuer(credentials.issuerId)
		.setAudience(AUDIENCE)
		.setExpirationTime(nowSeconds + TOKEN_TTL_SECONDS)
		.sign(secret);
}

export async function getAscToken(
	credentials: AppStoreApiCredentials,
): Promise<string> {
	const key = cacheKey(credentials);
	const cached = tokenCache.get(key);
	const refreshAtMs = Date.now() + REFRESH_MARGIN_SECONDS * 1_000;

	if (cached && cached.expiresAtMs > refreshAtMs) {
		return cached.token;
	}

	const token = await mintToken(credentials);
	tokenCache.set(key, {
		expiresAtMs: Date.now() + TOKEN_TTL_SECONDS * 1_000,
		token,
	});
	return token;
}

/**
 * Drops the cached token so the next request signs a fresh one.
 * Called when Apple rejects a token we believed was still valid (401).
 */
export function invalidateAscToken(credentials: AppStoreApiCredentials): void {
	tokenCache.delete(cacheKey(credentials));
}

/** Test seam — the cache is process-wide. */
export function clearAscTokenCache(): void {
	tokenCache.clear();
}
