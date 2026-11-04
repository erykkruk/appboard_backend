/** Store listing funnel: people who opened the listing and people who installed from it. */
export interface Funnel {
	acquisitions: number;
	/** acquisitions / visitors, 0..1; null when nobody visited. */
	conversionRate: number | null;
	visitors: number;
}

export interface TrafficSourceRow extends Funnel {
	source: string;
}

export interface SearchTermRow extends Funnel {
	term: string;
}

/** A Play placeholder in the search term column ("Other", "No search terms specified"). */
export interface PlaceholderRow extends Funnel {
	label: string;
}

export interface CampaignRow extends Funnel {
	utmCampaign: string;
	utmSource: string;
}

export interface CountryRow extends Funnel {
	country: string;
}

export interface TrafficReport {
	campaigns: CampaignRow[];
	searchTermPlaceholders: PlaceholderRow[];
	searchTerms: SearchTermRow[];
	sources: TrafficSourceRow[];
	totals: Funnel;
}

export interface InstallsReport {
	/** "Active Device Installs" of the last day in the file, when Play still reports it. */
	activeDevices: number | null;
	deviceInstalls: number;
	deviceUninstalls: number;
	installEvents: number;
	/** Last day covered by the file (YYYY-MM-DD). */
	lastDay: string | null;
	uninstallEvents: number;
	updateEvents: number;
	/** Daily User Installs summed: new users, not devices. */
	userInstalls: number;
	userUninstalls: number;
}

export interface MonthReport {
	countries: CountryRow[] | null;
	/** Which Play files existed for the month (Play writes only what it has). */
	files: { country: boolean; installs: boolean; trafficSource: boolean };
	installs: InstallsReport | null;
	/** Last day with traffic data (YYYY-MM-DD), null when the month has no file. */
	lastDay: string | null;
	/** YYYY-MM */
	month: string;
	traffic: TrafficReport | null;
}

/**
 * Why a report could not be read. Every value is a normal 200 answer: the
 * panel renders the fix for it instead of an error page.
 */
export const STORE_PERFORMANCE_STATUSES = [
	"ok",
	"bucket_missing",
	"integration_required",
	"access_denied",
	"bucket_not_found",
	"credentials_invalid",
	"error",
] as const;
export type StorePerformanceStatus =
	(typeof STORE_PERFORMANCE_STATUSES)[number];

export interface StorePerformanceReport {
	bucket: string | null;
	devices: string[];
	fetchedAt: string | null;
	/** Human readable explanation and fix for any status other than "ok". */
	message: string | null;
	months: MonthReport[];
	packageName: string;
	/** Service account the bucket is read with, so the user knows whom to grant. */
	serviceAccountEmail: string | null;
	status: StorePerformanceStatus;
	storeId: string;
	supported: true;
	/** Play reports all TV store traffic as "Other" with no search terms. */
	tvOnly: boolean;
}

export interface StorePerformanceUnsupported {
	message: string;
	platform: string;
	supported: false;
}

export type StorePerformanceResponse =
	| StorePerformanceReport
	| StorePerformanceUnsupported;
