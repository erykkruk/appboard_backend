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
