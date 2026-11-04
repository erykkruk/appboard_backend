import { langFor } from "@/modules/research/playstore.client";
import type { Clock } from "./rank-lookup";

/**
 * How long one Play search answers every tracked app that needs the same
 * keyword and country. Longer than the 4 h run limit, so the second app of a
 * scheduled slot (queued behind the first) still finds the first app's
 * answers; far shorter than the 24 h between two scheduled Play checks, so a
 * slot never reads the previous one.
 */
export const PLAY_SEARCH_REUSE_TTL_MS = 6 * 60 * 60_000;
/**
 * Upper bound on remembered searches (about 1.5 KB each: 50 package ids).
 * Prod tracks ~2,100 distinct Play pairs (2026-11-04).
 */
export const PLAY_SEARCH_REUSE_MAX_ENTRIES = 20_000;

interface Entry {
	at: number;
	ranking: readonly string[];
}

/**
 * Ordered package ids of recent Play web searches, process-wide (every app,
 * every workspace). Android TV packages rank in the same web search as
 * phones, so two Play apps of one developer tracking the same keywords need
 * one search per (keyword, country, language), not one per app. Only the ids
 * are kept, never the result payload.
 */
export class PlaySearchCache {
	private readonly entries = new Map<string, Entry>();

	constructor(
		private readonly now: Clock,
		private readonly ttlMs = PLAY_SEARCH_REUSE_TTL_MS,
		private readonly maxEntries = PLAY_SEARCH_REUSE_MAX_ENTRIES,
	) {}

	get size(): number {
		return this.entries.size;
	}

	get(keyword: string, country: string): readonly string[] | null {
		const key = playSearchKey(keyword, country);
		const entry = this.entries.get(key);
		if (!entry) return null;
		if (this.now() - entry.at >= this.ttlMs) {
			this.entries.delete(key);
			return null;
		}
		return entry.ranking;
	}

	set(keyword: string, country: string, ranking: readonly string[]): void {
		const key = playSearchKey(keyword, country);
		// Re-insert so Map order stays oldest first for eviction.
		this.entries.delete(key);
		this.entries.set(key, { at: this.now(), ranking: [...ranking] });
		this.evict();
	}

	private evict(): void {
		const now = this.now();
		for (const [key, entry] of this.entries) {
			if (this.entries.size <= this.maxEntries && now - entry.at < this.ttlMs) {
				return;
			}
			this.entries.delete(key);
		}
	}
}

/** Same query = same answer: keyword, storefront and the language we ask in. */
export function playSearchKey(keyword: string, country: string): string {
	const cc = country.toLowerCase();
	return `${langFor(cc)}\u0000${cc}\u0000${keyword.trim().toLowerCase()}`;
}
