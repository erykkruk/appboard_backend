import { buildError } from "@/utils/errors";
import type {
	KeywordCompetitor,
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
	bundleId?: string;
	releaseNotes?: string;
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
	languageCodesISO2A?: string[];
	primaryGenreName?: string;
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

/**
 * App Store localizations, keyed by the ISO-2 code the Lookup API reports in
 * `languageCodesISO2A`. `itunes` is the value the Lookup API's `l` parameter
 * wants; `listing` is the locale App Store Connect uses, which is what we
 * store as a listing language so a later real API connection lines up.
 * Verified against the live API: passing `l` returns genuinely localized
 * title, description AND screenshot URLs.
 */
const APP_STORE_LOCALES: Record<string, { itunes: string; listing: string }> = {
	AR: { itunes: "ar_sa", listing: "ar-SA" },
	CA: { itunes: "ca_es", listing: "ca" },
	CS: { itunes: "cs_cz", listing: "cs" },
	DA: { itunes: "da_dk", listing: "da" },
	DE: { itunes: "de_de", listing: "de-DE" },
	EL: { itunes: "el_gr", listing: "el" },
	EN: { itunes: "en_us", listing: "en-US" },
	ES: { itunes: "es_es", listing: "es-ES" },
	FI: { itunes: "fi_fi", listing: "fi" },
	FR: { itunes: "fr_fr", listing: "fr-FR" },
	HE: { itunes: "he_il", listing: "he" },
	HI: { itunes: "hi_in", listing: "hi" },
	HR: { itunes: "hr_hr", listing: "hr" },
	HU: { itunes: "hu_hu", listing: "hu" },
	ID: { itunes: "id_id", listing: "id" },
	IT: { itunes: "it_it", listing: "it" },
	JA: { itunes: "ja_jp", listing: "ja" },
	KO: { itunes: "ko_kr", listing: "ko" },
	MS: { itunes: "ms_my", listing: "ms" },
	NL: { itunes: "nl_nl", listing: "nl-NL" },
	NO: { itunes: "no_no", listing: "no" },
	PL: { itunes: "pl_pl", listing: "pl" },
	PT: { itunes: "pt_br", listing: "pt-BR" },
	RO: { itunes: "ro_ro", listing: "ro" },
	RU: { itunes: "ru_ru", listing: "ru" },
	SK: { itunes: "sk_sk", listing: "sk" },
	SV: { itunes: "sv_se", listing: "sv" },
	TH: { itunes: "th_th", listing: "th" },
	TR: { itunes: "tr_tr", listing: "tr" },
	UK: { itunes: "uk_ua", listing: "uk" },
	VI: { itunes: "vi_vn", listing: "vi" },
	ZH: { itunes: "zh_cn", listing: "zh-Hans" },
};

/** ISO-2 store language code -> the locale pair we use for it, if known. */
export function appStoreLocale(
	iso2: string,
): { itunes: string; listing: string } | null {
	return APP_STORE_LOCALES[iso2.trim().toUpperCase()] ?? null;
}

/** Our listing locale -> the ISO-2 code, for going back the other way. */
export function isoForListingLanguage(language: string): string | null {
	const wanted = language.toLowerCase();
	for (const [iso, pair] of Object.entries(APP_STORE_LOCALES)) {
		if (pair.listing.toLowerCase() === wanted) return iso;
	}
	// Tolerate a bare language where we store a region ("de" for "de-DE").
	const bare = wanted.split(/[-_]/)[0];
	for (const [iso, pair] of Object.entries(APP_STORE_LOCALES)) {
		if (pair.listing.toLowerCase().split("-")[0] === bare) return iso;
	}
	return null;
}

export async function appstoreMeta(
	id: string,
	country: string,
	/** ISO-2 language code; when set, the store answers in that language. */
	language?: string,
): Promise<ResearchAppMeta> {
	const locale = language ? appStoreLocale(language) : null;
	const data = await itunesFetch(
		`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&country=${encodeURIComponent(country)}${
			locale ? `&l=${locale.itunes}` : ""
		}`,
	);
	const app = (data.results as ItunesLookupResult[] | undefined)?.[0];
	if (!app) {
		buildError("notFound", {
			info: "App not found in the App Store for this country",
		});
	}
	return {
		bundleId: app.bundleId,
		contentRating: app.contentAdvisoryRating,
		country,
		description: app.description,
		developer: app.sellerName,
		free: app.price === 0,
		genre: (app.genres ?? []).slice(0, 2).join(", "),
		icon: app.artworkUrl100,
		id,
		languages: app.languageCodesISO2A,
		lastUpdate: app.currentVersionReleaseDate,
		price: app.formattedPrice,
		rating: app.averageUserRating,
		ratingsCount: app.userRatingCount,
		released: app.releaseDate,
		releaseNotes: app.releaseNotes,
		screenshotCount: (app.screenshotUrls ?? []).length,
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

function toKeywordCompetitor(r: ItunesLookupResult): KeywordCompetitor {
	return {
		developer: r.sellerName,
		genre: r.primaryGenreName ?? (r.genres ?? [])[0],
		icon: r.artworkUrl60 ?? r.artworkUrl100,
		price: r.formattedPrice,
		rating: r.averageUserRating,
		ratingsCount: r.userRatingCount,
		released: r.releaseDate,
		title: r.trackName,
		trackId: String(r.trackId),
		url: r.trackViewUrl,
	};
}

// ── App Store SSR fallback ─────────────────────────────────────────────
// When the iTunes Search API is throttled or down, the App Store web search
// page still server-renders the ranked result list into a
// `serialized-server-data` script tag. We extract the ordered app ids from it
// and hydrate them through the Lookup API, producing the same competitor
// shape as the primary path.

const SSR_LOOKUP_CHUNK = 50;

interface SsrData {
	data?: Array<{
		data?: {
			shelves?: Array<{
				items?: Array<{ lockup?: { adamId?: string | number } }>;
			}>;
			nextPage?: {
				results?: Array<{ id?: string | number; type?: string }>;
			};
		};
	}>;
}

/** Ordered app ids from the SSR search page JSON (ranking order, deduped). */
export function extractSsrAppIds(ssr: SsrData): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	const inner = ssr.data?.[0]?.data;
	if (!inner) return ids;
	for (const shelf of inner.shelves ?? []) {
		for (const item of shelf.items ?? []) {
			const id = item.lockup?.adamId;
			if (id !== undefined && !seen.has(String(id))) {
				ids.push(String(id));
				seen.add(String(id));
			}
		}
	}
	for (const result of inner.nextPage?.results ?? []) {
		if (result.type !== "apps") continue;
		const id = result.id;
		if (id !== undefined && !seen.has(String(id))) {
			ids.push(String(id));
			seen.add(String(id));
		}
	}
	return ids;
}

async function fetchSsrAppIds(
	keyword: string,
	country: string,
): Promise<string[]> {
	const res = await fetch(
		`https://apps.apple.com/${encodeURIComponent(country.toLowerCase())}/iphone/search?term=${encodeURIComponent(keyword)}`,
		{
			headers: {
				...UA,
				Accept: "text/html,application/xhtml+xml",
				"Accept-Language": "en-US,en;q=0.9",
			},
		},
	);
	if (!res.ok) {
		buildError("storeApiError", { info: `App Store SSR HTTP ${res.status}` });
	}
	const html = await res.text();
	const match = html.match(
		/<script[^>]*id="serialized-server-data"[^>]*>(.*?)<\/script>/s,
	);
	if (!match) {
		buildError("storeApiError", {
			info: "App Store SSR: serialized-server-data not found",
		});
	}
	return extractSsrAppIds(JSON.parse(match[1]) as SsrData);
}

/** Batch-hydrate app ids via the Lookup API, preserving the given order. */
async function lookupCompetitors(
	ids: string[],
	country: string,
): Promise<KeywordCompetitor[]> {
	const byId = new Map<string, KeywordCompetitor>();
	for (let start = 0; start < ids.length; start += SSR_LOOKUP_CHUNK) {
		const chunk = ids.slice(start, start + SSR_LOOKUP_CHUNK);
		try {
			const data = await itunesFetch(
				`https://itunes.apple.com/lookup?id=${chunk.join(",")}&country=${encodeURIComponent(country)}`,
			);
			for (const r of (data.results as ItunesLookupResult[] | undefined) ??
				[]) {
				if (r.trackId) byId.set(String(r.trackId), toKeywordCompetitor(r));
			}
		} catch {
			// Partial data beats none - continue with the next chunk.
		}
	}
	return ids
		.map((id) => byId.get(id))
		.filter((c): c is KeywordCompetitor => c !== undefined);
}

/**
 * Keyword search returning the full competitor fields needed for keyword
 * scoring (review counts, seller, release date, genre) in ranking order.
 * Primary: iTunes Search API. Fallback: App Store SSR page + Lookup API,
 * producing the identical shape so scoring is deterministic either way.
 */
export async function appstoreKeywordSearch(
	keyword: string,
	country: string,
	limit: number,
): Promise<KeywordCompetitor[]> {
	try {
		const data = await itunesFetch(
			`https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&entity=software&country=${encodeURIComponent(country)}&limit=${limit}`,
		);
		return ((data.results as ItunesLookupResult[] | undefined) ?? []).map(
			toKeywordCompetitor,
		);
	} catch (primaryError) {
		const ids = await fetchSsrAppIds(keyword, country).catch(() => {
			throw primaryError;
		});
		if (!ids.length) return [];
		const competitors = await lookupCompetitors(ids.slice(0, limit), country);
		if (!competitors.length) throw primaryError;
		return competitors;
	}
}

/**
 * Rank of an app in keyword search results, checking the top 200 (iTunes API
 * maximum). Falls back to the SSR ordered id list when the API is down.
 */
export async function appstoreKeywordRank(
	keyword: string,
	trackId: string,
	country: string,
): Promise<number | null> {
	try {
		const data = await itunesFetch(
			`https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&entity=software&country=${encodeURIComponent(country)}&limit=200`,
		);
		const idx = (
			(data.results as ItunesLookupResult[] | undefined) ?? []
		).findIndex((r) => String(r.trackId) === trackId);
		return idx >= 0 ? idx + 1 : null;
	} catch {
		// Lightweight fallback: position within the SSR ordered id list.
		try {
			const ids = await fetchSsrAppIds(keyword, country);
			const idx = ids.indexOf(trackId);
			return idx >= 0 ? idx + 1 : null;
		} catch {
			return null;
		}
	}
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
	// The RSS feed and the store web page are two PARTIAL views of the same
	// storefront: the feed came back for some apps in late 2026 but returns a
	// subset, and the page server-renders the most helpful ~20. Using the
	// page only when the feed is empty silently dropped every review the feed
	// happened to omit. Merge both and dedupe on content.
	const fromPage = await appstoreReviewsFromWebPage(id, country).catch(
		() => [] as ResearchReview[],
	);
	// Page entries go first: they carry the real review date, the feed does
	// not, and a dated duplicate must win over an undated one.
	const seen = new Set<string>();
	const merged: ResearchReview[] = [];
	for (const review of [...fromPage, ...reviews]) {
		const key = `${review.title ?? ""}|${review.stars}|${review.text}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(review);
	}
	return merged;
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
