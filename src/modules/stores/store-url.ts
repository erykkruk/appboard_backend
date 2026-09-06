import { DEFAULT_PUBLIC_COUNTRY } from "@/config/const";
import { parseStoreUrl } from "@/modules/research/research.types";

export interface ParsedStoreLink {
	country?: string;
	externalId: string;
	type: "app_store" | "google_play";
}

const PACKAGE_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const APPLE_ID_RE = /^\d{6,}$/;
const COUNTRY_RE = /^[a-z]{2}$/;

/**
 * Resolve user input into a store type + external id. Reuses the research
 * module's `parseStoreUrl` for full listing URLs and additionally accepts the
 * bare ids the typeahead works with: a numeric Apple id ("324684580") or an
 * Android package name ("com.example.app").
 */
export function parseStoreLink(input: string): ParsedStoreLink | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	if (APPLE_ID_RE.test(trimmed)) {
		return { externalId: trimmed, type: "app_store" };
	}
	if (!trimmed.includes("/") && PACKAGE_NAME_RE.test(trimmed)) {
		return { externalId: trimmed, type: "google_play" };
	}

	const parsed = parseStoreUrl(trimmed, "");
	if (!parsed) return null;
	const country = COUNTRY_RE.test(parsed.country) ? parsed.country : undefined;
	return {
		country,
		externalId: parsed.id,
		type: parsed.store === "appstore" ? "app_store" : "google_play",
	};
}

export function resolveImportCountry(
	requested: string | undefined,
	parsed: string | undefined,
): string {
	const value = requested?.trim().toLowerCase();
	if (value && COUNTRY_RE.test(value)) return value;
	return parsed ?? DEFAULT_PUBLIC_COUNTRY;
}
