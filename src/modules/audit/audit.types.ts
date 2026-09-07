import type { AuditResult } from "@/modules/research/listing-audit";
import type { KeywordScore } from "@/modules/research/scoring-types";

/**
 * "not-in-store" is its own state on purpose: an app you have not published
 * cannot be measured, and spinning on "measuring" forever (or showing 0/100)
 * would both be lies.
 */
export type AuditStatus = "measuring" | "ready" | "failed" | "not-in-store";

export interface AppAuditReport {
	appId: string;
	country: string;
	language: string;
	measuredAt: string;
	/** The listing as the store serves it right now. */
	store: AuditResult;
	/** The same rules applied to your unpublished draft, when one exists. */
	draft: (AuditResult & { changedFields: string[] }) | null;
	keywords: KeywordScore[];
	/**
	 * Of the scored keywords, the ones that belong to this app's own category
	 * and are therefore safe to act on. The rest are measured for context only
	 * - a search result can be dominated by a neighbouring category, and
	 * calling those terms "opportunities" would be advice, not data.
	 */
	recommendable: string[];
	/**
	 * False on Google Play: there is no keyword difficulty for it, so the
	 * report carries the text and screenshot rules only and the panel must not
	 * render an empty keyword table as "you rank for nothing".
	 */
	keywordsSupported: boolean;
	/**
	 * What the model made of the same numbers, when the workspace has a
	 * working OpenRouter key. Null otherwise; the deterministic report never
	 * depends on it.
	 */
	ai?: AuditAiInsights | null;
}

export interface AuditAiPriority {
	title: string;
	why: string;
	how: string;
}

export interface AuditAiRewrites {
	title: string | null;
	subtitle: string | null;
	keywords: string | null;
	opening: string | null;
}

export interface AuditAiInsights {
	generatedAt: string;
	/**
	 * Language of the rewrites (the audited listing's language). The summary
	 * and priorities are written in English, the panel's language.
	 */
	language: string;
	model: string;
	summary: string;
	priorities: AuditAiPriority[];
	rewrites: AuditAiRewrites;
}

export interface AppAuditResponse {
	status: AuditStatus;
	/** True while a background refresh runs over an older, still-shown report. */
	refreshing: boolean;
	/** Present for "ready" and for "failed" when an older report survives. */
	report: AppAuditReport | null;
	/** Why the last run failed, when it did. */
	error?: string;
}
