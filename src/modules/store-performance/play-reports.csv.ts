/**
 * Play Console bulk reports are CSV files encoded as UTF-16LE with a byte
 * order mark. Parsing is kept pure (bytes in, records out) so it can be
 * tested on real samples without any network.
 */

const BOM_CODEPOINT = 0xfeff;
const UTF16_LE_BOM = [0xff, 0xfe] as const;
const UTF16_BE_BOM = [0xfe, 0xff] as const;

/** One CSV row keyed by its lowercased, trimmed header name. */
export type CsvRecord = Record<string, string>;

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	return prefix.every((value, index) => bytes[index] === value);
}

function swapByteOrder(bytes: Uint8Array): Uint8Array {
	const swapped = new Uint8Array(bytes.length - (bytes.length % 2));
	for (let i = 0; i + 1 < bytes.length; i += 2) {
		swapped[i] = bytes[i + 1];
		swapped[i + 1] = bytes[i];
	}
	return swapped;
}

/**
 * Decode a report file. Play writes UTF-16LE with a BOM; a BOM-less file
 * with NUL bytes in the first characters is treated as UTF-16LE too, and
 * anything else as UTF-8, so a format change on Google's side degrades
 * instead of producing garbage.
 */
export function decodeReport(bytes: Uint8Array): string {
	let text: string;
	if (startsWith(bytes, UTF16_LE_BOM)) {
		text = new TextDecoder("utf-16le").decode(bytes);
	} else if (startsWith(bytes, UTF16_BE_BOM)) {
		text = new TextDecoder("utf-16le").decode(swapByteOrder(bytes));
	} else if (bytes.length > 1 && bytes[1] === 0) {
		text = new TextDecoder("utf-16le").decode(bytes);
	} else {
		text = new TextDecoder("utf-8").decode(bytes);
	}
	// Compare by codepoint: a literal BOM in source is invisible and easy to lose.
	return text.charCodeAt(0) === BOM_CODEPOINT ? text.slice(1) : text;
}

/** RFC 4180 style parser: quoted fields, doubled quotes, CRLF or LF rows. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	const pushRow = () => {
		row.push(field);
		if (row.some((value) => value !== "")) rows.push(row);
		row = [];
		field = "";
	};
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				field += '"';
				i += 1;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
			continue;
		}
		if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text[i + 1] === "\n") i += 1;
			pushRow();
		} else {
			field += char;
		}
	}
	pushRow();
	return rows;
}

/**
 * Rows as records keyed by lowercased header, so a reordered or re-cased
 * Google export cannot silently shift columns.
 */
export function toRecords(rows: string[][]): CsvRecord[] {
	const [header, ...body] = rows;
	if (!header) return [];
	const keys = header.map((name) => name.trim().toLowerCase());
	return body.map((cells) => {
		const record: CsvRecord = {};
		keys.forEach((key, index) => {
			record[key] = (cells[index] ?? "").trim();
		});
		return record;
	});
}

export function parseReport(bytes: Uint8Array): CsvRecord[] {
	return toRecords(parseCsv(decodeReport(bytes)));
}

/** First present column among `names` (lowercased), "" when none. */
export function field(record: CsvRecord, ...names: string[]): string {
	for (const name of names) {
		const value = record[name.toLowerCase()];
		if (value !== undefined) return value;
	}
	return "";
}

/** Numeric column; missing or non-numeric cells count as 0. */
export function numberField(record: CsvRecord, ...names: string[]): number {
	const value = Number(field(record, ...names));
	return Number.isFinite(value) ? value : 0;
}

/** Whether any of `names` is a column of the file. */
export function hasField(record: CsvRecord, ...names: string[]): boolean {
	return names.some((name) => record[name.toLowerCase()] !== undefined);
}
