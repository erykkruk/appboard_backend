import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { researchController } from "@/modules/research";
import { extractJson } from "@/modules/research/research.ai";
import { computeHeuristics } from "@/modules/research/research.heuristics";
import {
	parseStoreUrl,
	type ResearchReview,
} from "@/modules/research/research.types";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest } from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(researchController));

function review(stars: number, text: string, title?: string): ResearchReview {
	return { stars, store: "appstore", text, title };
}

describe("parseStoreUrl", () => {
	it("parses App Store URLs with country", () => {
		expect(
			parseStoreUrl("https://apps.apple.com/pl/app/spotify/id324684580"),
		).toEqual({ country: "pl", id: "324684580", store: "appstore" });
	});

	it("parses App Store URLs without country using the default", () => {
		expect(
			parseStoreUrl("https://apps.apple.com/app/spotify/id324684580", "de"),
		).toEqual({ country: "de", id: "324684580", store: "appstore" });
	});

	it("parses legacy itunes.apple.com URLs", () => {
		expect(
			parseStoreUrl("https://itunes.apple.com/us/app/foo/id111222333"),
		).toEqual({ country: "us", id: "111222333", store: "appstore" });
	});

	it("parses Google Play URLs and reads the gl country param", () => {
		expect(
			parseStoreUrl(
				"https://play.google.com/store/apps/details?id=com.spotify.music&gl=PL",
			),
		).toEqual({ country: "pl", id: "com.spotify.music", store: "playstore" });
	});

	it("falls back to the default country for Play URLs without gl", () => {
		expect(
			parseStoreUrl(
				"https://play.google.com/store/apps/details?id=com.foo.bar",
			),
		).toEqual({ country: "us", id: "com.foo.bar", store: "playstore" });
	});

	it("returns null for unrecognized URLs and empty input", () => {
		expect(parseStoreUrl("https://example.com/app")).toBeNull();
		expect(parseStoreUrl("")).toBeNull();
		expect(parseStoreUrl("   ")).toBeNull();
	});
});

describe("computeHeuristics", () => {
	it("counts star distribution and negative share", () => {
		const stats = computeHeuristics([
			review(5, "great app"),
			review(4, "nice"),
			review(3, "meh"),
			review(1, "app keeps crashing"),
		]);
		expect(stats.total).toBe(4);
		expect(stats.byStars[5]).toBe(1);
		expect(stats.byStars[1]).toBe(1);
		expect(stats.negative).toBe(2);
		expect(stats.negativeShare).toBe(0.5);
	});

	it("buckets negative reviews by keyword (EN + PL) with quotes", () => {
		const stats = computeHeuristics([
			review(1, "the app keeps crashing after login"),
			review(2, "aplikacja się wywala i nie działa"),
			review(1, "too many ads everywhere"),
			review(5, "crash? never happened, love it"),
		]);
		const crash = stats.buckets.find((b) => b.id === "crash-bugi");
		expect(crash).toBeDefined();
		expect(crash?.count).toBe(2);
		expect(crash?.quotes.length).toBe(2);
		expect(crash?.quotes[0]).toStartWith("[1★]");
		const ads = stats.buckets.find((b) => b.id === "reklamy");
		expect(ads?.count).toBe(1);
	});

	it("ignores positive reviews for buckets and handles empty input", () => {
		const positiveOnly = computeHeuristics([review(5, "crash crash crash")]);
		expect(positiveOnly.buckets).toHaveLength(0);
		const empty = computeHeuristics([]);
		expect(empty.total).toBe(0);
		expect(empty.negativeShare).toBe(0);
	});

	it("sorts buckets by count descending", () => {
		const stats = computeHeuristics([
			review(1, "wolno działa i muli"),
			review(2, "strasznie wolne, muli się"),
			review(1, "za dużo reklam"),
		]);
		expect(stats.buckets[0].id).toBe("wydajnosc");
	});
});

describe("extractJson", () => {
	it("extracts fenced json blocks", () => {
		expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
		expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
	});

	it("slices from first { to last } for unfenced content", () => {
		expect(extractJson('Oto wynik: {"a":{"b":2}} — koniec')).toBe(
			'{"a":{"b":2}}',
		);
	});

	it("throws a typed error when no JSON is present", () => {
		expect(() => extractJson("no json here")).toThrow();
	});
});

describe("Research endpoints (auth + validation)", () => {
	it("rejects unauthenticated requests", async () => {
		const res = await app.handle(
			new Request("http://localhost/api/research/search", {
				body: JSON.stringify({ country: "us", term: "spotify" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(401);
	});

	it("POST /scrape returns 400 for an unrecognized URL", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/research/scrape", {
				body: JSON.stringify({ url: "https://example.com/nope" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(400);
	});

	it("POST /scrape returns 400 when neither url nor store+id given", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/research/scrape", {
				body: JSON.stringify({ deep: false }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(400);
	});

	it("POST /keywords validates required fields", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/research/keywords", {
				body: JSON.stringify({ keywords: [] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(422);
	});

	it("POST /search returns empty suggestions for a too-short term", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/research/search", {
				body: JSON.stringify({ country: "us", term: "a" }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { suggestions: unknown[] };
		expect(body.suggestions).toEqual([]);
	});

	it("POST /analyze returns 400 without a configured OpenRouter key", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/research/analyze", {
				body: JSON.stringify({
					meta: [
						{
							country: "us",
							developer: "Dev",
							id: "123",
							store: "appstore",
							title: "Foo",
							url: "https://apps.apple.com/us/app/foo/id123",
						},
					],
					reviews: [{ stars: 1, store: "appstore", text: "bad" }],
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			code?: string;
			data?: { info?: string };
		};
		expect(body.code).toBe("BAD_REQUEST");
		expect(body.data?.info ?? "").toContain("OpenRouter");
	});
});
