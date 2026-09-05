import { createHash } from "node:crypto";
import Elysia, { t } from "elysia";
import { buildError } from "@/utils/errors";
import { checkRateLimit, rateLimitEnabled } from "@/utils/rate-limit";
import { PlayProxyService } from "./play-proxy.service";
import { PublicReportsService } from "./public-reports.service";
import {
	FREE_TOOLS,
	type FreeTool,
	FreeToolQuotaService,
} from "./quota.service";

const MAX_REPORTS_PER_HOUR = 10;
const MAX_PLAY_LOOKUPS_PER_HOUR = 20;
const MAX_PLAY_KEYWORD_CALLS_PER_HOUR = 120;
const MAX_PLAY_SEARCHES_PER_HOUR = 60;
const MAX_IMAGE_PROXY_PER_HOUR = 600;
// Google's image CDN is blocked by some privacy blockers, so Play artwork is
// re-served from our own origin. Whitelisted hosts only - never an open proxy.
const IMAGE_HOSTS = new Set([
	"play-lh.googleusercontent.com",
	"lh3.googleusercontent.com",
]);
const IMAGE_CACHE_SECONDS = 86_400;

// Cookie half of the quota subject pair (the other half is the hashed IP).
const QUOTA_COOKIE = "ab_free_tools";
const QUOTA_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

function hashIp(ip: string): string {
	return createHash("sha256").update(ip).digest("hex");
}

function clientIp(request: Request): string {
	return (
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
	);
}

/**
 * The visitor's quota subjects: hashed IP plus a cookie id (minted here on
 * first use). Both are counted so neither clearing cookies nor changing IP
 * alone resets the daily allowance.
 */
function quotaSubjects(
	request: Request,
	cookie: Record<string, { value?: string; set: (o: unknown) => void }>,
): Array<{ kind: "ip" | "cookie"; value: string }> {
	const existing = cookie[QUOTA_COOKIE]?.value;
	const id = existing ?? crypto.randomUUID();
	if (!existing) {
		cookie[QUOTA_COOKIE]?.set({
			httpOnly: true,
			maxAge: QUOTA_COOKIE_MAX_AGE,
			path: "/",
			sameSite: "lax",
			value: id,
		});
	}
	return [
		{ kind: "ip", value: hashIp(clientIp(request)) },
		{ kind: "cookie", value: id },
	];
}
const WINDOW_MS = 60 * 60 * 1000;

const APP_OR_PACKAGE_ID = "^[0-9A-Za-z._-]{1,255}$";

const keywordObservation = t.Object(
	{
		appRank: t.Optional(t.Nullable(t.Number({ maximum: 200, minimum: 1 }))),
		classification: t.String({ maxLength: 32, minLength: 1 }),
		difficulty: t.Number({ maximum: 100, minimum: 0 }),
		keyword: t.String({ maxLength: 255, minLength: 1 }),
		opportunity: t.Number({ maximum: 100, minimum: 0 }),
		popularity: t.Optional(t.Nullable(t.Number({ maximum: 100, minimum: 1 }))),
	},
	{ additionalProperties: false },
);

const reportBody = t.Object(
	{
		appName: t.Optional(t.String({ maxLength: 255 })),
		asoScore: t.Optional(t.Number({ maximum: 100, minimum: 0 })),
		country: t.String({ maxLength: 2, minLength: 2 }),
		keywords: t.Array(keywordObservation, { maxItems: 20, minItems: 1 }),
		store: t.Optional(t.Union([t.Literal("appstore"), t.Literal("playstore")])),
		trackId: t.Optional(
			t.String({ maxLength: 255, minLength: 1, pattern: APP_OR_PACKAGE_ID }),
		),
	},
	{ additionalProperties: false },
);

/**
 * Public (pre-auth-guard) ingest for the free browser-side ASO check-up.
 * The visitor's browser fetches iTunes data itself, runs the shared scoring
 * engine locally and posts only the RESULTS here - the backend never calls
 * Apple for anonymous check-ups. Client data is untrusted: strictly
 * validated, stored under source="web_client", never merged into
 * workspace-scoped tables. Rate-limited per IP; only a hash of the IP is
 * stored (abuse tracing), never the address itself.
 */
export const publicReportsController = new Elysia({
	prefix: "/api/public",
})
	.post(
		"/aso-reports",
		async ({ body, request }) => {
			const ip = clientIp(request);
			if (
				rateLimitEnabled() &&
				!checkRateLimit(`aso-report:${ip}`, MAX_REPORTS_PER_HOUR, WINDOW_MS)
			) {
				buildError("rateLimitExceeded", {
					info: "Too many check-ups from this address. Try again in an hour.",
				});
			}
			const ipHash = hashIp(ip);
			return PublicReportsService.store(body, ipHash);
		},
		{
			body: reportBody,
			detail: {
				description:
					"Store an anonymous browser-computed ASO check-up (free tool ingest)",
				tags: ["Public"],
			},
		},
	)
	.post(
		"/play/lookup",
		async ({ body, request }) => {
			const ip = clientIp(request);
			if (
				rateLimitEnabled() &&
				!checkRateLimit(
					`play-lookup:${ip}`,
					MAX_PLAY_LOOKUPS_PER_HOUR,
					WINDOW_MS,
				)
			) {
				buildError("rateLimitExceeded", {
					info: "Too many Play look-ups from this address. Try again later.",
				});
			}
			return PlayProxyService.lookup(body.appId, body.country);
		},
		{
			body: t.Object({
				appId: t.String({
					maxLength: 255,
					minLength: 1,
					pattern: APP_OR_PACKAGE_ID,
				}),
				country: t.String({ maxLength: 2, minLength: 2 }),
			}),
			detail: {
				description:
					"Public Google Play app lookup for the free check-up (Play has no CORS API, so this thin proxy stands in for the browser)",
				tags: ["Public"],
			},
		},
	)
	.post(
		"/play/search",
		async ({ body, request }) => {
			const ip = clientIp(request);
			if (
				rateLimitEnabled() &&
				!checkRateLimit(
					`play-search:${ip}`,
					MAX_PLAY_SEARCHES_PER_HOUR,
					WINDOW_MS,
				)
			) {
				buildError("rateLimitExceeded", {
					info: "Too many searches from this address. Try again later.",
				});
			}
			const suggestions = await PlayProxyService.searchApps(
				body.term,
				body.country,
			);
			return { suggestions };
		},
		{
			body: t.Object({
				country: t.String({ maxLength: 2, minLength: 2 }),
				term: t.String({ maxLength: 255, minLength: 2 }),
			}),
			detail: {
				description:
					"Public Google Play app-name search for the free check-up typeahead",
				tags: ["Public"],
			},
		},
	)
	.get(
		"/quota",
		async ({ cookie, request }) => {
			const subjects = quotaSubjects(
				request,
				cookie as unknown as Record<
					string,
					{ value?: string; set: (o: unknown) => void }
				>,
			);
			return FreeToolQuotaService.status(subjects);
		},
		{
			detail: {
				description: "Remaining daily allowance of the free tools",
				tags: ["Public"],
			},
		},
	)
	.post(
		"/quota/consume",
		async ({ body, cookie, request, set }) => {
			const subjects = quotaSubjects(
				request,
				cookie as unknown as Record<
					string,
					{ value?: string; set: (o: unknown) => void }
				>,
			);
			const result = await FreeToolQuotaService.consume(
				subjects,
				body.tool as FreeTool,
				body.units ?? 1,
			);
			if (!result.allowed) set.status = 429;
			return result;
		},
		{
			body: t.Object({
				tool: t.Union(FREE_TOOLS.map((tool) => t.Literal(tool))),
				units: t.Optional(t.Number({ maximum: 20, minimum: 1 })),
			}),
			detail: {
				description:
					"Consume part of the daily free-tool allowance (429 when exhausted)",
				tags: ["Public"],
			},
		},
	)
	.get(
		"/play/image",
		async ({ query, request, set }) => {
			const ip = clientIp(request);
			if (
				rateLimitEnabled() &&
				!checkRateLimit(`play-image:${ip}`, MAX_IMAGE_PROXY_PER_HOUR, WINDOW_MS)
			) {
				buildError("rateLimitExceeded", {
					info: "Too many image requests from this address.",
				});
			}
			let target: URL;
			try {
				target = new URL(query.u);
			} catch {
				buildError("badRequest", { info: "Invalid image URL." });
			}
			if (target.protocol !== "https:" || !IMAGE_HOSTS.has(target.hostname)) {
				buildError("badRequest", {
					info: "Only Google Play artwork can be proxied.",
				});
			}
			const upstream = await fetch(target.toString());
			if (!upstream.ok) {
				buildError("notFound", { info: "Image not available." });
			}
			const contentType = upstream.headers.get("content-type") ?? "";
			if (!contentType.startsWith("image/")) {
				buildError("badRequest", { info: "Target is not an image." });
			}
			set.headers["cache-control"] =
				`public, max-age=${IMAGE_CACHE_SECONDS}, immutable`;
			set.headers["content-type"] = contentType;
			return new Response(upstream.body, {
				headers: {
					"cache-control": `public, max-age=${IMAGE_CACHE_SECONDS}, immutable`,
					"content-type": contentType,
				},
			});
		},
		{
			detail: {
				description:
					"Re-serve Google Play artwork from our origin (privacy blockers often block Google's image CDN)",
				tags: ["Public"],
			},
			query: t.Object({ u: t.String({ maxLength: 1024, minLength: 8 }) }),
		},
	)
	.post(
		"/play/keyword-data",
		async ({ body, request }) => {
			const ip = clientIp(request);
			if (
				rateLimitEnabled() &&
				!checkRateLimit(
					`play-keyword:${ip}`,
					MAX_PLAY_KEYWORD_CALLS_PER_HOUR,
					WINDOW_MS,
				)
			) {
				buildError("rateLimitExceeded", {
					info: "Too many Play keyword checks from this address. Try again later.",
				});
			}
			return PlayProxyService.keywordData(
				body.keyword,
				body.country,
				body.appId,
			);
		},
		{
			body: t.Object({
				appId: t.Optional(
					t.String({
						maxLength: 255,
						minLength: 1,
						pattern: APP_OR_PACKAGE_ID,
					}),
				),
				country: t.String({ maxLength: 2, minLength: 2 }),
				keyword: t.String({ maxLength: 255, minLength: 1 }),
			}),
			detail: {
				description:
					"Public Google Play competitors + rank for one keyword (cached per keyword+country for a day)",
				tags: ["Public"],
			},
		},
	);
