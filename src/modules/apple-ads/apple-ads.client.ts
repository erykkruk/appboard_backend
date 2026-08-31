/**
 * Thin client for the official Apple Ads Platform API v1.
 *
 * Auth: a short-lived ES256 JWT (signed locally with the stored private key)
 * is exchanged at appleid.apple.com for a 1-hour Bearer token, cached in
 * memory per client id. The popularity endpoint is a DATASET, not a lookup:
 * it returns Apple's top search terms per (country, genre) for a completed
 * Sun-Sat week - the sync service downloads it into local tables and all
 * keyword lookups happen against those.
 */
import { createPrivateKey, sign } from "node:crypto";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("apple-ads");

const API_BASE = "https://api.ads.apple.com/v1";
const TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";
const JWT_AUDIENCE = "https://appleid.apple.com";
const OAUTH_SCOPE = "searchadsorg";

const CLIENT_SECRET_TTL_S = 3600;
const TOKEN_REFRESH_MARGIN_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const TRANSIENT_BASE_DELAY_MS = 1_000;
const RATE_LIMIT_BASE_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 16_000;

export const APPLE_ADS_PAGE_SIZE = 5_000;
// Weekly datasets are generated Mondays at 07:00 UTC for the preceding
// Sun-Sat week.
const PUBLICATION_HOUR_UTC = 7;

const POPULARITY_FIELDS = [
	"rankInGenre",
	"searchPopularityInGenre",
	"searchPopularity1to100",
	"searchPopularity1to5",
];

export interface AppleAdsCredentials {
	adAccountId?: string;
	clientId: string;
	keyId: string;
	privateKey: string;
	teamId: string;
}

export interface AppleTopTermRow {
	searchTerm?: unknown;
	genre?: unknown;
	rankInGenre?: unknown;
	searchPopularityInGenre?: unknown;
	searchPopularity1to100?: unknown;
	searchPopularity1to5?: unknown;
}

function base64url(input: string | Buffer): string {
	return Buffer.from(input)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Sign a short-lived ES256 JWT used as the OAuth client secret. */
export function buildClientSecret(creds: AppleAdsCredentials): string {
	const now = Math.floor(Date.now() / 1000);
	const header = base64url(JSON.stringify({ alg: "ES256", kid: creds.keyId }));
	const payload = base64url(
		JSON.stringify({
			aud: JWT_AUDIENCE,
			exp: now + CLIENT_SECRET_TTL_S,
			iat: now,
			iss: creds.teamId,
			sub: creds.clientId,
		}),
	);
	const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
		dsaEncoding: "ieee-p1363",
		key: createPrivateKey(creds.privateKey),
	});
	return `${header}.${payload}.${base64url(signature)}`;
}

// Token cache keyed by client id (multi-workspace safe).
const tokenCache = new Map<string, { expiresAt: number; token: string }>();

async function fetchAccessToken(creds: AppleAdsCredentials): Promise<string> {
	const secret = buildClientSecret(creds);
	const body = new URLSearchParams({
		client_id: creds.clientId,
		client_secret: secret,
		grant_type: "client_credentials",
		scope: OAUTH_SCOPE,
	});
	const res = await fetch(TOKEN_URL, {
		body,
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		method: "POST",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (res.status === 400 || res.status === 401 || res.status === 403) {
		buildError("badRequest", {
			info:
				"Apple rejected the Apple Ads credentials. Check the Client ID, " +
				"Team ID, Key ID and that the public key is still uploaded in the " +
				"Apple Ads UI.",
		});
	}
	if (!res.ok) {
		buildError("storeApiError", {
			info: `Apple Ads token request failed (HTTP ${res.status})`,
		});
	}
	const data = (await res.json()) as {
		access_token?: string;
		expires_in?: number;
	};
	if (!data.access_token) {
		buildError("storeApiError", {
			info: "Apple Ads token response had an unexpected shape",
		});
	}
	const token = data.access_token;
	tokenCache.set(creds.clientId, {
		expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
		token,
	});
	return token;
}

async function bearer(creds: AppleAdsCredentials): Promise<string> {
	const cached = tokenCache.get(creds.clientId);
	if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
		return cached.token;
	}
	return fetchAccessToken(creds);
}

export function invalidateTokenCache(clientId: string): void {
	tokenCache.delete(clientId);
}

function retryDelayMs(
	status: number,
	retryAfter: string | null,
	attempt: number,
): number {
	if (status === 429 && retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) {
			return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, seconds * 1000));
		}
	}
	const base =
		status === 429 ? RATE_LIMIT_BASE_DELAY_MS : TRANSIENT_BASE_DELAY_MS;
	return Math.min(MAX_RETRY_DELAY_MS, base * 2 ** (attempt - 1));
}

async function request(
	method: string,
	path: string,
	creds: AppleAdsCredentials,
	jsonBody?: unknown,
): Promise<Record<string, unknown>> {
	let retriedAuth = false;
	for (let attempt = 1; ; attempt++) {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${await bearer(creds)}`,
		};
		if (creds.adAccountId) {
			headers["X-AP-Context"] = `adAccountId=${creds.adAccountId}`;
		}
		if (jsonBody !== undefined) headers["Content-Type"] = "application/json";

		let res: Response;
		try {
			res = await fetch(`${API_BASE}${path}`, {
				body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
				headers,
				method,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (err) {
			if (attempt >= MAX_ATTEMPTS) {
				buildError("storeApiError", {
					info: `Apple Ads network error calling ${path}: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
			await Bun.sleep(retryDelayMs(0, null, attempt));
			continue;
		}

		if (res.status === 200) {
			return (await res.json()) as Record<string, unknown>;
		}
		if (res.status === 401 && !retriedAuth) {
			// The cached token may have just expired - refresh once.
			retriedAuth = true;
			invalidateTokenCache(creds.clientId);
			continue;
		}
		if (res.status === 401) {
			buildError("unauthorized", {
				info: "Apple rejected the Apple Ads session. Reconnect from Settings.",
			});
		}
		if (res.status === 403 || res.status === 404) {
			buildError("badRequest", {
				info: `Apple denied access to ${path} (HTTP ${res.status}). Check the API role and the selected ad account.`,
			});
		}
		if (res.status === 429 || res.status >= 500) {
			if (attempt >= MAX_ATTEMPTS) {
				buildError("storeApiError", {
					info: `Apple Ads request to ${path} failed after retries (HTTP ${res.status})`,
				});
			}
			await Bun.sleep(
				retryDelayMs(res.status, res.headers.get("Retry-After"), attempt),
			);
			continue;
		}
		buildError("storeApiError", {
			info: `Apple Ads request to ${path} failed (HTTP ${res.status})`,
		});
	}
}

// ── Discovery ─────────────────────────────────────────────────────────

export async function getMe(
	creds: AppleAdsCredentials,
): Promise<{ orgId: string | null; userId: string | null }> {
	const payload = await request("GET", "/me", creds);
	const result = (payload.result ?? payload.data ?? {}) as Record<
		string,
		unknown
	>;
	return {
		orgId: result.orgId != null ? String(result.orgId) : null,
		userId: result.userId != null ? String(result.userId) : null,
	};
}

export async function listAcls(creds: AppleAdsCredentials): Promise<
	Array<{
		adAccountId: string | null;
		adAccountName: string;
		orgId: string | null;
	}>
> {
	const payload = await request("GET", "/acls", creds);
	let raw = payload.result ?? payload.data ?? [];
	if (raw && !Array.isArray(raw) && typeof raw === "object") {
		const obj = raw as Record<string, unknown>;
		raw = obj.acls ?? obj.userAcls ?? [];
	}
	if (!Array.isArray(raw)) {
		log.warn("Apple Ads /acls returned an unexpected shape");
		return [];
	}
	return raw
		.filter((item): item is Record<string, unknown> => !!item)
		.map((item) => {
			const account = (item.adAccount ?? {}) as Record<string, unknown>;
			return {
				adAccountId: account.id != null ? String(account.id) : null,
				adAccountName: String(account.name ?? ""),
				orgId: account.orgId != null ? String(account.orgId) : null,
			};
		});
}

// ── Insights: search term popularity ──────────────────────────────────

function parseRows(payload: Record<string, unknown>): AppleTopTermRow[] {
	const result = payload.result ?? {};
	let rows: unknown =
		result && typeof result === "object" && !Array.isArray(result)
			? (result as Record<string, unknown>).rows
			: result;
	if (!Array.isArray(rows)) rows = [];
	return (rows as unknown[]).filter(
		(r): r is AppleTopTermRow => !!r && typeof r === "object",
	);
}

export async function queryTopTermsPage(
	creds: AppleAdsCredentials,
	country: string,
	weekStart: string,
	offset: number,
	pageSize = APPLE_ADS_PAGE_SIZE,
): Promise<AppleTopTermRow[]> {
	const weekEnd = new Date(
		new Date(`${weekStart}T00:00:00Z`).getTime() + 6 * 24 * 60 * 60 * 1000,
	)
		.toISOString()
		.slice(0, 10);
	const payload = await request(
		"POST",
		"/insights/apps/search-term-popularity/query",
		creds,
		{
			fields: POPULARITY_FIELDS,
			filters: [
				{
					field: "countryOrRegion",
					operator: "EQUALS",
					value: country.toUpperCase(),
				},
			],
			// No sorting/fetchTotalCount: the live endpoint rejects both
			// documented properties; the pager terminates on a short page.
			pagination: { offset, pageSize },
			timeRange: {
				end: weekEnd,
				granularity: "WEEKLY_SUN_SAT",
				start: weekStart,
			},
		},
	);
	return parseRows(payload);
}

// ── Insights: impression share ────────────────────────────────────────

export interface AppleImpressionRow {
	searchTerm?: unknown;
	countryOrRegion?: unknown;
	week?: unknown;
	lowImpressionShare?: unknown;
	highImpressionShare?: unknown;
	rank?: unknown;
	searchPopularity1to5?: unknown;
}

export async function queryImpressionShare(
	creds: AppleAdsCredentials,
	promotedObjectId: string,
	weekStart: string,
	weeks: number,
): Promise<AppleImpressionRow[]> {
	const cappedWeeks = Math.max(1, Math.min(4, weeks));
	const end = new Date(
		new Date(`${weekStart}T00:00:00Z`).getTime() +
			(7 * cappedWeeks - 1) * 24 * 60 * 60 * 1000,
	)
		.toISOString()
		.slice(0, 10);
	const payload = await request(
		"POST",
		"/insights/apps/impression-share/query",
		creds,
		{
			// The live endpoint rejects EQUALS for promotedObjectId - IN only.
			filters: [
				{
					field: "promotedObjectId",
					operator: "IN",
					value: [promotedObjectId],
				},
			],
			options: { impressionShareReportType: "ALL_SLOTS" },
			pagination: { offset: 0, pageSize: APPLE_ADS_PAGE_SIZE },
			timeRange: { end, granularity: "WEEKLY_SUN_SAT", start: weekStart },
		},
	);
	return parseRows(payload) as AppleImpressionRow[];
}

// ── Week math (UTC, fixed by the API contract) ────────────────────────

/** Sunday (YYYY-MM-DD) starting the Sun-Sat week containing `day`. */
export function weekStartSunday(day: Date): string {
	const utcDay = new Date(
		Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
	);
	const dow = utcDay.getUTCDay(); // 0 = Sunday
	utcDay.setUTCDate(utcDay.getUTCDate() - dow);
	return utcDay.toISOString().slice(0, 10);
}

/**
 * Sunday of the newest COMPLETED week Apple has published: weekly data for
 * the preceding Sun-Sat week is generated Mondays at 07:00 UTC.
 */
export function latestAvailableWeek(now = new Date()): string {
	const currentWeekStart = weekStartSunday(now);
	const publication = new Date(`${currentWeekStart}T00:00:00Z`);
	publication.setUTCDate(publication.getUTCDate() + 1); // Monday
	publication.setUTCHours(PUBLICATION_HOUR_UTC, 0, 0, 0);
	const weeksBack = now.getTime() >= publication.getTime() ? 7 : 14;
	const week = new Date(`${currentWeekStart}T00:00:00Z`);
	week.setUTCDate(week.getUTCDate() - weeksBack);
	return week.toISOString().slice(0, 10);
}
