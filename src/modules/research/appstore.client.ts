import { buildError } from "@/utils/errors";
import type {
	ResearchAppMeta,
	ResearchReview,
	SearchSuggestion,
} from "./research.types";

const UA = { "User-Agent": "Mozilla/5.0 (AppBoard Research)" };
const MAX_REVIEW_PAGES = 5;
const MAX_REVIEW_PAGES_DEEP = 10;
const SEARCH_LIMIT = 50;
const COMPETITOR_TERM_LIMIT = 10;
const MAX_COMPETITORS = 8;
const MAX_SCREENSHOTS = 6;
const FULL_RSS_PAGE_SIZE = 50;

interface ItunesLookupResult {
	trackId?: number;
	trackName: string;
	sellerName: string;
	artworkUrl60?: string;
	artworkUrl100?: string;
	averageUserRating?: number;
	userRatingCount?: number;
	description?: string;
	currentVersionReleaseDate?: string;
	releaseDate?: string;
	version?: string;
	trackViewUrl: string;
	genres?: string[];
	contentAdvisoryRating?: string;
	formattedPrice?: string;
	price?: number;
	screenshotUrls?: string[];
}

async function itunesFetch(url: string): Promise<Record<string, unknown>> {
	const res = await fetch(url, { headers: UA });
	if (!res.ok) {
		buildError("storeApiError", { info: `iTunes API HTTP ${res.status}` });
	}
	return (await res.json()) as Record<string, unknown>;
}

export async function appstoreMeta(
	id: string,
	country: string,
): Promise<ResearchAppMeta> {
	const data = await itunesFetch(
		`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=${encodeURIComponent(country)}`,
	);
	const app = (data.results as ItunesLookupResult[] | undefined)?.[0];
	if (!app) {
		buildError("notFound", {
			info: "App not found in the App Store for this country",
		});
	}
	return {
		contentRating: app.contentAdvisoryRating,
		country,
		description: app.description,
		developer: app.sellerName,
		free: app.price === 0,
		genre: (app.genres ?? []).slice(0, 2).join(", "),
		icon: app.artworkUrl100,
		id,
		lastUpdate: app.currentVersionReleaseDate,
		price: app.formattedPrice,
		rating: app.averageUserRating,
		ratingsCount: app.userRatingCount,
		released: app.releaseDate,
		screenshots: (app.screenshotUrls ?? []).slice(0, MAX_SCREENSHOTS),
		store: "appstore",
		title: app.trackName,
		url: app.trackViewUrl,
		version: app.version,
	};
}

export async function appstoreSearch(
	term: string,
	country: string,
	limit: number,
): Promise<SearchSuggestion[]> {
	const data = await itunesFetch(
		`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${encodeURIComponent(country)}&limit=${limit}`,
	);
	return ((data.results as ItunesLookupResult[] | undefined) ?? []).map(
		(r) => ({
			developer: r.sellerName,
			icon: r.artworkUrl60,
			id: String(r.trackId),
			rating: r.averageUserRating,
			store: "appstore" as const,
			title: r.trackName,
			url: r.trackViewUrl,
		}),
	);
}

export async function appstoreReviews(
	id: string,
	country: string,
	deep = false,
): Promise<ResearchReview[]> {
	const reviews: ResearchReview[] = [];
	const maxPages = deep ? MAX_REVIEW_PAGES_DEEP : MAX_REVIEW_PAGES;
	for (let page = 1; page <= maxPages; page++) {
		const res = await fetch(
			`https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${id}/sortby=mostrecent/json`,
			{ headers: UA },
		);
		if (!res.ok) break;
		let entries: unknown[];
		try {
			const data = (await res.json()) as {
				feed?: { entry?: unknown };
			};
			const e = data.feed?.entry;
			entries = Array.isArray(e) ? e : e ? [e] : [];
		} catch {
			break;
		}
		for (const raw of entries) {
			const e = raw as Record<string, { label?: string }>;
			const stars = Number.parseInt(e["im:rating"]?.label ?? "0", 10);
			const text = e.content?.label;
			if (!text || !stars) continue;
			reviews.push({
				stars,
				store: "appstore",
				text,
				title: e.title?.label,
				version: e["im:version"]?.label,
			});
		}
		if (entries.length < FULL_RSS_PAGE_SIZE) break;
	}
	if (reviews.length) return reviews;
	// Apple quietly emptied the customerreviews RSS feed (returns 0 entries
	// for every app as of mid-2026) — fall back to the reviews Apple
	// server-renders into the store web page (~20 most helpful ones).
	return appstoreReviewsFromWebPage(id, country);
}

interface EmbeddedReview {
	title?: string;
	contents?: string;
	rating?: number;
	date?: string;
}

/** Slice one balanced JSON object starting at the `{` at or before `from`. */
function sliceJsonObject(html: string, from: number): string | null {
	const start = html.lastIndexOf("{", from);
	if (start === -1) return null;
	let depth = 0;
	let inString = false;
	for (let i = start; i < html.length; i++) {
		const ch = html[i];
		if (inString) {
			if (ch === "\\") i++;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return html.slice(start, i + 1);
		}
	}
	return null;
}

async function appstoreReviewsFromWebPage(
	id: string,
	country: string,
): Promise<ResearchReview[]> {
	const res = await fetch(
		`https://apps.apple.com/${country}/app/id${id}?see-all=reviews`,
		{ headers: UA },
	);
	if (!res.ok) return [];
	const html = await res.text();
	const reviews: ResearchReview[] = [];
	const marker = '"$kind":"Review"';
	let cursor = html.indexOf(marker);
	while (cursor !== -1) {
		const objText = sliceJsonObject(html, cursor);
		if (objText) {
			try {
				const obj = JSON.parse(objText) as EmbeddedReview;
				if (obj.contents && obj.rating) {
					reviews.push({
						date: obj.date,
						stars: obj.rating,
						store: "appstore",
						text: obj.contents,
						title: obj.title,
					});
				}
			} catch {
				// skip malformed fragment
			}
		}
		cursor = html.indexOf(marker, cursor + marker.length);
	}
	return reviews;
}

export async function appstoreSearchPosition(
	keyword: string,
	trackId: string,
	country: string,
): Promise<number | null> {
	const res = await fetch(
		`https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&entity=software&country=${encodeURIComponent(country)}&limit=${SEARCH_LIMIT}`,
		{ headers: UA },
	);
	if (!res.ok) return null;
	const data = (await res.json()) as { results?: Array<{ trackId?: number }> };
	const idx = (data.results ?? []).findIndex(
		(r) => String(r.trackId) === trackId,
	);
	return idx >= 0 ? idx + 1 : null;
}

/**
 * iTunes has no public "similar apps" API — approximate competitors with
 * top search results for the genre and the main word of the title.
 */
export async function appstoreCompetitors(
	id: string,
	title: string,
	genre: string,
	country: string,
): Promise<SearchSuggestion[]> {
	const mainWord =
		title.split(/[\s:—–-]+/).filter((w) => w.length > 3)[0] ?? title;
	const out: SearchSuggestion[] = [];
	const seen = new Set<string>([id]);
	for (const term of [genre, mainWord]) {
		if (!term) continue;
		let results: SearchSuggestion[];
		try {
			results = await appstoreSearch(term, country, COMPETITOR_TERM_LIMIT);
		} catch {
			continue;
		}
		for (const r of results) {
			if (seen.has(r.id)) continue;
			seen.add(r.id);
			out.push(r);
		}
	}
	return out.slice(0, MAX_COMPETITORS);
}
