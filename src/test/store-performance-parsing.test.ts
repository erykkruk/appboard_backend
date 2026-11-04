import { describe, expect, it } from "bun:test";
import {
	aggregateCountries,
	aggregateInstalls,
	aggregateTraffic,
	isSearchTermPlaceholder,
	lastDay,
} from "@/modules/store-performance/play-reports.aggregate";
import { normalizePlayReportsBucket } from "@/modules/store-performance/play-reports.bucket";
import {
	decodeReport,
	parseCsv,
	parseReport,
} from "@/modules/store-performance/play-reports.csv";
import {
	clampMonths,
	reportMonths,
} from "@/modules/store-performance/store-performance.service";
import {
	BUZZIN_OCT_TRAFFIC as BUZZIN_OCT,
	fixtureReport,
	TV_OCT_TRAFFIC as TV_OCT,
	TV_SEP_TRAFFIC as TV_SEP,
	utf16Report,
} from "./play-report-fixtures";

describe("Play report decoding", () => {
	it("decodes UTF-16LE with a BOM and drops the BOM", () => {
		const bytes = utf16Report(
			["Date", "Traffic source"],
			[["2026-10-01", "Other"]],
		);
		const text = decodeReport(bytes);
		expect(text.charCodeAt(0)).not.toBe(0xfeff);
		expect(text.startsWith("Date,Traffic source")).toBe(true);
	});

	it("decodes UTF-16BE and BOM-less UTF-16LE and plain UTF-8", () => {
		const le = Buffer.from("Date,X\r\n1,2", "utf16le");
		const be = Buffer.from(le);
		for (let i = 0; i + 1 < be.length; i += 2) {
			const a = be[i];
			be[i] = be[i + 1];
			be[i + 1] = a;
		}
		const withBeBom = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
		expect(decodeReport(new Uint8Array(withBeBom))).toBe("Date,X\r\n1,2");
		expect(decodeReport(new Uint8Array(le))).toBe("Date,X\r\n1,2");
		expect(decodeReport(new TextEncoder().encode("Date,X\n1,2"))).toBe(
			"Date,X\n1,2",
		);
	});

	it("parses quoted fields, doubled quotes and skips blank lines", () => {
		expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2\n')).toEqual([
			["a", "b"],
			["x, y", 'say "hi"'],
			["1", "2"],
		]);
	});

	it("keys records by lowercased header so column order does not matter", () => {
		const records = parseReport(
			utf16Report(
				["Store listing visitors", "DATE", "Traffic source"],
				[["5", "2026-10-02", "Other"]],
			),
		);
		expect(records).toEqual([
			{
				date: "2026-10-02",
				"store listing visitors": "5",
				"traffic source": "Other",
			},
		]);
	});

	it("returns no records for an empty file", () => {
		expect(parseReport(new Uint8Array([0xff, 0xfe]))).toEqual([]);
	});
});

describe("traffic source aggregation (real October 2026 sample)", () => {
	const report = aggregateTraffic(parseReport(fixtureReport(BUZZIN_OCT)));

	it("matches the hand-computed totals per traffic source", () => {
		expect(
			report.sources.map(({ acquisitions, source, visitors }) => ({
				acquisitions,
				source,
				visitors,
			})),
		).toEqual([
			{ acquisitions: 1191, source: "Other", visitors: 1717 },
			{ acquisitions: 1100, source: "Ads and referrals", visitors: 1322 },
			{ acquisitions: 509, source: "Google Play search", visitors: 590 },
		]);
		expect(report.totals.acquisitions).toBe(2800);
		expect(report.totals.visitors).toBe(3629);
	});

	it("computes conversion from summed counts, not from Play's per-row rates", () => {
		const search = report.sources.find(
			(s) => s.source === "Google Play search",
		);
		expect(search?.conversionRate).toBeCloseTo(509 / 590, 10);
	});

	it("lists real search terms and keeps Play placeholders apart", () => {
		expect(report.searchTerms).toEqual([
			{
				acquisitions: 509,
				conversionRate: 509 / 590,
				term: "buzzin",
				visitors: 590,
			},
		]);
		expect(
			report.searchTermPlaceholders.map(
				({ acquisitions, label, visitors }) => ({
					acquisitions,
					label,
					visitors,
				}),
			),
		).toEqual([
			{ acquisitions: 1191, label: "Other", visitors: 1717 },
			{
				acquisitions: 1100,
				label: "No search terms specified",
				visitors: 1322,
			},
		]);
	});

	it("groups UTM campaigns and leaves out rows with no UTM at all", () => {
		const keys = report.campaigns.map((c) => `${c.utmSource}/${c.utmCampaign}`);
		expect(keys).toContain("meta/quiz-show-pl-meta-abo-test-storeclick-202609");
		expect(keys).toContain("meta/Other");
		expect(keys).not.toContain("Other/Other");
		expect(keys).not.toContain(
			"No UTM source specified/No UTM campaign specified",
		);
		const total = report.campaigns.reduce((sum, c) => sum + c.visitors, 0);
		expect(total).toBeLessThanOrEqual(1322);
	});

	it("reports the last day of the file", () => {
		expect(lastDay(parseReport(fixtureReport(BUZZIN_OCT)))).toBe("2026-10-24");
	});
});

describe("Android TV sample", () => {
	it("is all Other with no search terms (242 / 412 over Sep + Oct)", () => {
		const months = [TV_SEP, TV_OCT].map((name) =>
			aggregateTraffic(parseReport(fixtureReport(name))),
		);
		for (const month of months) {
			expect(month.sources.map((s) => s.source)).toEqual(["Other"]);
			expect(month.searchTerms).toEqual([]);
		}
		const acquisitions = months.reduce(
			(sum, m) => sum + m.totals.acquisitions,
			0,
		);
		const visitors = months.reduce((sum, m) => sum + m.totals.visitors, 0);
		expect({ acquisitions, visitors }).toEqual({
			acquisitions: 242,
			visitors: 412,
		});
	});
});

describe("placeholders", () => {
	it("recognises Play's placeholder search terms in any case", () => {
		for (const term of [
			"Other",
			"other",
			"No search terms specified",
			"",
			"  ",
		]) {
			expect(isSearchTermPlaceholder(term)).toBe(true);
		}
		expect(isSearchTermPlaceholder("buzzin")).toBe(false);
		expect(isSearchTermPlaceholder("other games")).toBe(false);
	});

	it("folds case of real terms and handles a missing term as Not reported", () => {
		const report = aggregateTraffic([
			{
				"search term": "Buzzin",
				"store listing acquisitions": "1",
				"store listing visitors": "2",
				"traffic source": "Google Play search",
			},
			{
				"search term": "buzzin",
				"store listing acquisitions": "3",
				"store listing visitors": "4",
				"traffic source": "Google Play search",
			},
			{ "store listing acquisitions": "1", "store listing visitors": "1" },
		]);
		expect(report.searchTerms).toEqual([
			{ acquisitions: 4, conversionRate: 4 / 6, term: "buzzin", visitors: 6 },
		]);
		expect(report.searchTermPlaceholders[0]?.label).toBe("Not reported");
		expect(report.sources.map((s) => s.source)).toContain("Other");
	});

	it("gives a null conversion rate when nobody visited", () => {
		const report = aggregateTraffic([
			{
				"store listing acquisitions": "0",
				"store listing visitors": "0",
				"traffic source": "Other",
			},
		]);
		expect(report.totals.conversionRate).toBeNull();
	});
});

describe("country and installs aggregation", () => {
	it("sums countries over days, busiest first, whatever the header spelling", () => {
		const countries = aggregateCountries(
			parseReport(
				utf16Report(
					[
						"Date",
						"Package name",
						// Play's spelling (store_performance_<pkg>_202610_country.csv).
						"Country / region",
						"Store listing acquisitions",
						"Store listing visitors",
						"Store listing conversion rate",
					],
					[
						["2026-10-01", "p", "PL", "10", "20", "0.5"],
						["2026-10-02", "p", "PL", "5", "10", "0.5"],
						["2026-10-01", "p", "es", "4", "8", "0.5"],
						["2026-10-01", "p", "Other", "1", "3", "0.33"],
					],
				),
			),
		);
		expect(countries).toEqual([
			{ acquisitions: 15, conversionRate: 0.5, country: "PL", visitors: 30 },
			{ acquisitions: 4, conversionRate: 0.5, country: "ES", visitors: 8 },
			{ acquisitions: 1, conversionRate: 1 / 3, country: "Other", visitors: 3 },
		]);
		const alt = aggregateCountries([
			{
				country: "de",
				"store listing acquisitions": "1",
				"store listing visitors": "2",
			},
		]);
		expect(alt[0]?.country).toBe("DE");
	});

	it("sums installs and takes active devices from the last day", () => {
		const installs = aggregateInstalls(
			parseReport(
				utf16Report(
					// Header exactly as Play writes it (installs_<pkg>_202610_overview.csv).
					[
						"Date",
						"Package name",
						"Daily Device Installs",
						"Daily Device Uninstalls",
						"Daily Device Upgrades",
						"Total User Installs",
						"Daily User Installs",
						"Daily User Uninstalls",
						"Active Device Installs",
						"Install events",
						"Update events",
						"Uninstall events",
					],
					[
						[
							"2026-10-02",
							"p",
							"7",
							"1",
							"0",
							"0",
							"6",
							"1",
							"120",
							"8",
							"3",
							"2",
						],
						[
							"2026-10-01",
							"p",
							"5",
							"2",
							"0",
							"0",
							"4",
							"2",
							"110",
							"6",
							"1",
							"2",
						],
					],
				),
			),
		);
		expect(installs).toEqual({
			activeDevices: 120,
			deviceInstalls: 12,
			deviceUninstalls: 3,
			installEvents: 14,
			lastDay: "2026-10-02",
			uninstallEvents: 4,
			updateEvents: 4,
			userInstalls: 10,
			userUninstalls: 3,
		});
	});

	it("leaves active devices null when Play no longer reports the column", () => {
		const installs = aggregateInstalls([
			{ "daily device installs": "3", date: "2026-10-01" },
		]);
		expect(installs.activeDevices).toBeNull();
		expect(installs.deviceInstalls).toBe(3);
	});
});

describe("bucket normalization", () => {
	it("accepts the bare name, the gs:// URI and longer paths", () => {
		for (const input of [
			"pubsite_prod_5411382577729402537",
			"  gs://pubsite_prod_5411382577729402537  ",
			"gs://pubsite_prod_5411382577729402537/",
			"GS://pubsite_prod_5411382577729402537/stats/installs/",
			"https://console.cloud.google.com/storage/browser/pubsite_prod_5411382577729402537/stats?pli=1",
		]) {
			expect(normalizePlayReportsBucket(input)).toBe(
				"pubsite_prod_5411382577729402537",
			);
		}
	});

	it("rejects anything that is not a bucket name", () => {
		for (const input of [
			"",
			"gs://",
			"a",
			"pubsite prod",
			"../etc",
			"gs://x/../",
			"https://evil.example/x",
		]) {
			expect(normalizePlayReportsBucket(input)).toBeNull();
		}
	});
});

describe("month window", () => {
	it("counts calendar months back from now, across a year boundary", () => {
		expect(reportMonths(new Date("2026-01-15T10:00:00Z"), 3)).toEqual([
			"202601",
			"202512",
			"202511",
		]);
	});

	it("clamps the requested number of months", () => {
		expect(clampMonths(undefined)).toBe(3);
		expect(clampMonths(0)).toBe(1);
		expect(clampMonths(40)).toBe(12);
		expect(clampMonths(2.7)).toBe(2);
	});
});
