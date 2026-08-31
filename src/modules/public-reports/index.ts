import { createHash } from "node:crypto";
import Elysia, { t } from "elysia";
import { buildError } from "@/utils/errors";
import { checkRateLimit, rateLimitEnabled } from "@/utils/rate-limit";
import { PublicReportsService } from "./public-reports.service";

const MAX_REPORTS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;

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
		trackId: t.String({ maxLength: 32, minLength: 1, pattern: "^[0-9]+$" }),
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
}).post(
	"/aso-reports",
	async ({ body, request }) => {
		const ip =
			request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
			"unknown";
		if (
			rateLimitEnabled() &&
			!checkRateLimit(`aso-report:${ip}`, MAX_REPORTS_PER_HOUR, WINDOW_MS)
		) {
			buildError("rateLimitExceeded", {
				info: "Too many check-ups from this address. Try again in an hour.",
			});
		}
		const ipHash = createHash("sha256").update(ip).digest("hex");
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
);
