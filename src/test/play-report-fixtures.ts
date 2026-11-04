import fixture from "./fixtures/play-traffic-source.json";

/** Real Play traffic-source rows (buzzin, Sep-Oct 2026), no secrets. */
export const TRAFFIC_FIXTURE = fixture;
export type TrafficFixtureFile = keyof typeof fixture.files;

export const BUZZIN_OCT_TRAFFIC: TrafficFixtureFile =
	"stats/store_performance/store_performance_tech.ravenlab.buzzin_202610_traffic_source.csv";
export const TV_SEP_TRAFFIC: TrafficFixtureFile =
	"stats/store_performance/store_performance_com.playbuzzin.tv_202609_traffic_source.csv";
export const TV_OCT_TRAFFIC: TrafficFixtureFile =
	"stats/store_performance/store_performance_com.playbuzzin.tv_202610_traffic_source.csv";

function csvLine(cells: string[]): string {
	return cells
		.map((cell) =>
			/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
		)
		.join(",");
}

/** Encode like Play does: UTF-16LE with a byte order mark, CRLF rows. */
export function utf16Report(columns: string[], rows: string[][]): Uint8Array {
	const text = [columns, ...rows].map(csvLine).join("\r\n");
	return new Uint8Array(
		Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
	);
}

export function fixtureReport(name: TrafficFixtureFile): Uint8Array {
	return utf16Report(fixture.columns, fixture.files[name]);
}
