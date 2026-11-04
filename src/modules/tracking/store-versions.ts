import { appstoreMeta } from "@/modules/research/appstore.client";
import { playstoreMeta } from "@/modules/research/playstore.client";
import type { ResearchStore } from "@/modules/research/research.types";
import { buildError } from "@/utils/errors";

/** A store version and when the store says it went live. */
export interface StoreRelease {
	releasedAt: Date | null;
	versionString: string;
}

/**
 * Public, credential-free reads of an app's store version. Both work for
 * apps added from a store link, and both answer what the STORE serves, which
 * is what a ranking was measured against (a synced ASC row can be a draft).
 */
export interface StoreVersionSource {
	/** The version live in the store right now; null = the store has none. */
	live(
		store: ResearchStore,
		externalId: string,
		country: string,
		pace: StorePacer,
	): Promise<StoreRelease | null>;
	/** Every release the store lists, oldest first (App Store only lists them). */
	history(
		store: ResearchStore,
		externalId: string,
		country: string,
		pace: StorePacer,
	): Promise<StoreRelease[]>;
}

/**
 * Runs one store request under the rank-check throttle and retry policy. A
 * source wraps every request it sends in it; one that sends none skips it,
 * so it never takes a lookup slot.
 */
export type StorePacer = <T>(call: () => Promise<T>) => Promise<T>;

const PAGE_HEADERS = {
	Accept: "text/html,application/xhtml+xml",
	"Accept-Language": "en-US,en;q=0.9",
	"User-Agent": "Mozilla/5.0 (AppBoard Research)",
};

/** Play shows this instead of a version when builds differ per device. */
const PLAY_VARIES_WITH_DEVICE = /varies with device/i;

const VERSION_HISTORY_MARKER = '"page":"versionHistory"';
const VERSION_HISTORY_ENTRY =
	/"primarySubtitle":"([^"]{1,50})","secondarySubtitle":"([^"]{1,120})"/g;

function toDate(value: string | number | undefined | null): Date | null {
	if (value === undefined || value === null || value === "") return null;
	// "Mon Nov 02 2026 23:23:18 GMT+0000 (Coordinated Universal Time)": the
	// zone name in brackets is not part of any format Date.parse promises.
	const cleaned =
		typeof value === "string" ? value.replace(/\s*\(.*\)\s*$/, "") : value;
	const date = new Date(cleaned);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Releases from the "Version History" sheet the App Store web page renders
 * into its server data (newest first there), returned oldest first. Entries
 * whose date does not parse are dropped rather than guessed.
 */
export function parseAppStoreVersionHistory(html: string): StoreRelease[] {
	const start = html.indexOf(VERSION_HISTORY_MARKER);
	if (start < 0) return [];
	const section = html.slice(start);
	const seen = new Set<string>();
	const releases: StoreRelease[] = [];
	for (const match of section.matchAll(VERSION_HISTORY_ENTRY)) {
		const versionString = match[1].trim();
		const releasedAt = toDate(match[2]);
		if (!releasedAt || seen.has(versionString)) continue;
		seen.add(versionString);
		releases.push({ releasedAt, versionString });
	}
	return releases.sort(
		(a, b) => (a.releasedAt?.getTime() ?? 0) - (b.releasedAt?.getTime() ?? 0),
	);
}

async function appStoreHistory(
	externalId: string,
	country: string,
): Promise<StoreRelease[]> {
	const res = await fetch(
		`https://apps.apple.com/${encodeURIComponent(country.toLowerCase())}/app/id${encodeURIComponent(externalId)}`,
		{ headers: PAGE_HEADERS },
	);
	if (!res.ok) {
		buildError("storeApiError", {
			info: `App Store page HTTP ${res.status}`,
			retryAfter: res.headers.get("retry-after"),
			status: res.status,
		});
	}
	return parseAppStoreVersionHistory(await res.text());
}

async function liveRelease(
	store: ResearchStore,
	externalId: string,
	country: string,
	pace: StorePacer,
): Promise<StoreRelease | null> {
	const meta = await pace(() =>
		store === "appstore"
			? appstoreMeta(externalId, country)
			: playstoreMeta(externalId, country),
	);
	const versionString = meta.version?.trim();
	if (!versionString || PLAY_VARIES_WITH_DEVICE.test(versionString)) {
		return null;
	}
	return { releasedAt: toDate(meta.lastUpdate), versionString };
}

export const publicStoreVersions: StoreVersionSource = {
	async history(store, externalId, country, pace) {
		if (store === "appstore") {
			const releases = await pace(() => appStoreHistory(externalId, country));
			if (releases.length) return releases;
		}
		// Play lists no history: the live version and its update date is all
		// there is, so only measurements after that date can be attributed.
		const live = await liveRelease(store, externalId, country, pace);
		return live ? [live] : [];
	},
	live: liveRelease,
};

/** Knows no versions. The default under the test runner, which never reaches a store. */
export const NO_STORE_VERSIONS: StoreVersionSource = {
	history: async () => [],
	live: async () => null,
};
