const GS_SCHEME = "gs://";
const CONSOLE_URL_MARKER = "storage/browser/";
/** Cloud Storage bucket naming rules (lowercase, digits, -, _, .; 3-63 chars per name). */
const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

/**
 * Turn what the user pasted from Play Console (Download reports > Copy Cloud
 * Storage URI) into a bare bucket name. Accepts `pubsite_prod_123`,
 * `gs://pubsite_prod_123`, `gs://pubsite_prod_123/stats/installs/...` and a
 * Cloud Console browser URL. Returns null for anything that is not a valid
 * bucket name, so it never ends up in a request path.
 */
export function normalizePlayReportsBucket(input: string): string | null {
	let value = input.trim();
	if (!value) return null;
	const consoleIndex = value.indexOf(CONSOLE_URL_MARKER);
	if (consoleIndex >= 0) {
		value = value.slice(consoleIndex + CONSOLE_URL_MARKER.length);
	} else if (value.toLowerCase().startsWith(GS_SCHEME)) {
		value = value.slice(GS_SCHEME.length);
	}
	const bucket = (value.split(/[/?#]/)[0] ?? "").trim().toLowerCase();
	return BUCKET_NAME.test(bucket) ? bucket : null;
}
