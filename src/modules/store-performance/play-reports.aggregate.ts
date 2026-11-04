import {
	type CsvRecord,
	field,
	hasField,
	numberField,
} from "./play-reports.csv";
import type {
	CampaignRow,
	CountryRow,
	Funnel,
	InstallsReport,
	PlaceholderRow,
	SearchTermRow,
	TrafficReport,
	TrafficSourceRow,
} from "./store-performance.types";

/** How many real search terms a month lists (Play rarely reports more). */
export const SEARCH_TERMS_LIMIT = 50;
export const CAMPAIGNS_LIMIT = 50;

const OTHER_SOURCE = "Other";
const COUNTRY_CODE = /^[a-z]{2}$/i;
const UNREPORTED_TERM = "Not reported";

/**
 * Values Play writes into the search term column when it has no term to
 * show: "Other" for traffic it does not attribute, "No search terms
 * specified" for referrals. They are totals, not keywords.
 */
const SEARCH_TERM_PLACEHOLDERS = new Set([
	"",
	"other",
	"no search terms specified",
]);
const UTM_PLACEHOLDERS = new Set([
	"",
	"other",
	"no utm source specified",
	"no utm campaign specified",
]);

const COLUMN = {
	acquisitions: "store listing acquisitions",
	activeDevices: "active device installs",
	country: ["country / region", "country/region", "country"],
	date: "date",
	deviceInstalls: "daily device installs",
	deviceUninstalls: "daily device uninstalls",
	installEvents: "install events",
	searchTerm: "search term",
	trafficSource: "traffic source",
	uninstallEvents: "uninstall events",
	updateEvents: "update events",
	userInstalls: "daily user installs",
	userUninstalls: "daily user uninstalls",
	utmCampaign: "utm campaign",
	utmSource: "utm source",
	visitors: "store listing visitors",
} as const;

export function isSearchTermPlaceholder(term: string): boolean {
	return SEARCH_TERM_PLACEHOLDERS.has(term.trim().toLowerCase());
}

function isUtmPlaceholder(value: string): boolean {
	return UTM_PLACEHOLDERS.has(value.trim().toLowerCase());
}

/** Rate from the summed counts: averaging Play's per-row rates would weight a 1-visitor day like a busy one. */
export function funnel(acquisitions: number, visitors: number): Funnel {
	return {
		acquisitions,
		conversionRate: visitors > 0 ? acquisitions / visitors : null,
		visitors,
	};
}

class FunnelTally<Key> {
	private readonly totals = new Map<
		string,
		{ acquisitions: number; key: Key; visitors: number }
	>();

	add(id: string, key: Key, acquisitions: number, visitors: number): void {
		const current = this.totals.get(id) ?? {
			acquisitions: 0,
			key,
			visitors: 0,
		};
		current.acquisitions += acquisitions;
		current.visitors += visitors;
		this.totals.set(id, current);
	}

	/** Busiest first; ties by acquisitions, then by id so the order is stable. */
	rows(): Array<{ funnel: Funnel; id: string; key: Key }> {
		return [...this.totals.entries()]
			.map(([id, total]) => ({
				funnel: funnel(total.acquisitions, total.visitors),
				id,
				key: total.key,
			}))
			.sort(
				(a, b) =>
					b.funnel.visitors - a.funnel.visitors ||
					b.funnel.acquisitions - a.funnel.acquisitions ||
					a.id.localeCompare(b.id),
			);
	}
}

/** Latest Date value of a file (YYYY-MM-DD sorts lexically). */
export function lastDay(records: CsvRecord[]): string | null {
	let latest: string | null = null;
	for (const record of records) {
		const day = field(record, COLUMN.date);
		if (day && (latest === null || day > latest)) latest = day;
	}
	return latest;
}

/** One month of `store_performance_<pkg>_<YYYYMM>_traffic_source.csv`. */
export function aggregateTraffic(records: CsvRecord[]): TrafficReport {
	let acquisitions = 0;
	let visitors = 0;
	const sources = new FunnelTally<string>();
	const terms = new FunnelTally<string>();
	const placeholders = new FunnelTally<string>();
	const campaigns = new FunnelTally<{
		utmCampaign: string;
		utmSource: string;
	}>();

	for (const record of records) {
		const rowAcquisitions = numberField(record, COLUMN.acquisitions);
		const rowVisitors = numberField(record, COLUMN.visitors);
		acquisitions += rowAcquisitions;
		visitors += rowVisitors;

		const source = field(record, COLUMN.trafficSource) || OTHER_SOURCE;
		sources.add(source, source, rowAcquisitions, rowVisitors);

		const term = field(record, COLUMN.searchTerm);
		if (isSearchTermPlaceholder(term)) {
			const label = term || UNREPORTED_TERM;
			placeholders.add(
				label.toLowerCase(),
				label,
				rowAcquisitions,
				rowVisitors,
			);
		} else {
			// Play lowercases terms already; folding keeps "Buzzin" and "buzzin" one row.
			const normalized = term.toLowerCase();
			terms.add(normalized, normalized, rowAcquisitions, rowVisitors);
		}

		const utmSource = field(record, COLUMN.utmSource);
		const utmCampaign = field(record, COLUMN.utmCampaign);
		if (!isUtmPlaceholder(utmSource) || !isUtmPlaceholder(utmCampaign)) {
			campaigns.add(
				JSON.stringify([utmSource, utmCampaign]),
				{ utmCampaign, utmSource },
				rowAcquisitions,
				rowVisitors,
			);
		}
	}

	return {
		campaigns: campaigns
			.rows()
			.slice(0, CAMPAIGNS_LIMIT)
			.map(({ funnel: f, key }): CampaignRow => ({ ...key, ...f })),
		searchTermPlaceholders: placeholders
			.rows()
			.map(({ funnel: f, key }): PlaceholderRow => ({ label: key, ...f })),
		searchTerms: terms
			.rows()
			.slice(0, SEARCH_TERMS_LIMIT)
			.map(({ funnel: f, key }): SearchTermRow => ({ term: key, ...f })),
		sources: sources
			.rows()
			.map(({ funnel: f, key }): TrafficSourceRow => ({ source: key, ...f })),
		totals: funnel(acquisitions, visitors),
	};
}

/** One month of `store_performance_<pkg>_<YYYYMM>_country.csv`. */
export function aggregateCountries(records: CsvRecord[]): CountryRow[] {
	const countries = new FunnelTally<string>();
	for (const record of records) {
		// Play writes ISO codes plus an "Other" bucket for small countries.
		const raw = field(record, ...COLUMN.country);
		const country = COUNTRY_CODE.test(raw)
			? raw.toUpperCase()
			: raw || OTHER_SOURCE;
		countries.add(
			country,
			country,
			numberField(record, COLUMN.acquisitions),
			numberField(record, COLUMN.visitors),
		);
	}
	return countries
		.rows()
		.map(({ funnel: f, key }): CountryRow => ({ country: key, ...f }));
}

/** One month of `installs_<pkg>_<YYYYMM>_overview.csv`. */
export function aggregateInstalls(records: CsvRecord[]): InstallsReport {
	const report: InstallsReport = {
		activeDevices: null,
		deviceInstalls: 0,
		deviceUninstalls: 0,
		installEvents: 0,
		lastDay: lastDay(records),
		uninstallEvents: 0,
		updateEvents: 0,
		userInstalls: 0,
		userUninstalls: 0,
	};
	let activeDay = "";
	for (const record of records) {
		report.deviceInstalls += numberField(record, COLUMN.deviceInstalls);
		report.deviceUninstalls += numberField(record, COLUMN.deviceUninstalls);
		report.installEvents += numberField(record, COLUMN.installEvents);
		report.uninstallEvents += numberField(record, COLUMN.uninstallEvents);
		report.updateEvents += numberField(record, COLUMN.updateEvents);
		report.userInstalls += numberField(record, COLUMN.userInstalls);
		report.userUninstalls += numberField(record, COLUMN.userUninstalls);
		const day = field(record, COLUMN.date);
		const active = field(record, COLUMN.activeDevices);
		if (
			hasField(record, COLUMN.activeDevices) &&
			active !== "" &&
			day >= activeDay
		) {
			activeDay = day;
			report.activeDevices = numberField(record, COLUMN.activeDevices);
		}
	}
	return report;
}
