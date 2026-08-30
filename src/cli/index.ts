import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import type { AppBoardClient } from "@/mcp/client";
import { createClient, loadClientConfig } from "@/mcp/client";
import type { KeywordScore } from "@/modules/research/research.types";

/**
 * Standalone CLI for the AppBoard API, intended for CI pipelines and terminal
 * research:
 *
 * - `upload` - upload a folder of screenshots (the web-based equivalent of
 *   ButterKit's Fastlane-folder upload). Each image is validated against the
 *   display type's accepted dimensions before upload, so a wrong-sized asset
 *   fails fast with an actionable message instead of being silently distorted.
 * - `keywords` - score App Store keywords (popularity, difficulty, opportunity,
 *   classification, download estimates) straight in the console.
 *
 * Authentication reuses the MCP client (`@/mcp/client`): the API key comes from
 * APPBOARD_API_KEY and the base URL from APPBOARD_API_URL (or `--api-url`).
 */

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

/** Image MIME type for a screenshot file, keyed by extension. */
const MIME_BY_EXTENSION: Record<string, string> = {
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
};

const USAGE = `appboard — AppBoard API command line

Usage:
  appboard upload --app <appId> --lang <locale> --platform <apple|gp> \\
    --display-type <type> [--version <versionId>] [--api-url <url>] <dir>
  appboard keywords --country <cc> [--track-id <id>] [--json] \\
    [--api-url <url>] <keyword>[, <keyword>...]

upload arguments:
  <dir>                  Directory containing screenshots (.png/.jpg/.jpeg)

upload options:
  --app <appId>          App UUID (required)
  --lang <locale>        Listing locale, e.g. en-US (required)
  --platform <apple|gp>  Target platform: apple (App Store) or gp (Google Play) (required)
  --display-type <type>  Display type the screenshots target (required, see below)
  --version <versionId>  Version to upload into. Defaults to the first editable
                         version (Apple) or "default" (Google Play)

keywords arguments:
  <keyword>[, ...]       Up to 10 keywords, comma-separated or as separate args

keywords options:
  --country <cc>         Two-letter App Store country, e.g. us, pl (required)
  --track-id <id>        App Store track id — also reports your app's rank
  --json                 Print the full JSON response instead of the table

Shared options:
  --api-url <url>        Backend base URL. Overrides APPBOARD_API_URL
  -h, --help             Show this help

Environment:
  APPBOARD_API_KEY       Bearer API key (ab_...). Required
  APPBOARD_API_URL       Backend base URL (default http://localhost:6680)

Valid display types:
  Apple:  APP_IPHONE_35, APP_IPHONE_40, APP_IPHONE_47, APP_IPHONE_55,
          APP_IPHONE_58, APP_IPHONE_61, APP_IPHONE_65, APP_IPHONE_67,
          APP_IPAD_PRO_129
  Google: phone, sevenInch, tenInch

Files are uploaded in sorted filename order, which becomes their display order.
`;

/** Exit code returned by the CLI: 0 = all succeeded, 1 = usage error or any failure. */
type ExitCode = 0 | 1;

interface UploadArgs {
	apiUrl?: string;
	appId: string;
	displayType: string;
	dir: string;
	lang: string;
	platform: "apple" | "gp";
	version?: string;
}

/** A user-facing error that should print its message and exit 1 (no stack trace). */
class CliError extends Error {}

/**
 * Parse and validate the `upload` command arguments. Throws {@link CliError}
 * with an actionable message (no stack trace) for any missing/invalid flag so
 * callers can print it and exit 1.
 */
function parseUploadArgs(argv: string[]): UploadArgs {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		args: argv,
		options: {
			"api-url": { type: "string" },
			app: { type: "string" },
			"display-type": { type: "string" },
			lang: { type: "string" },
			platform: { type: "string" },
			version: { type: "string" },
		},
	});

	const missing: string[] = [];
	if (!values.app) missing.push("--app");
	if (!values.lang) missing.push("--lang");
	if (!values.platform) missing.push("--platform");
	if (!values["display-type"]) missing.push("--display-type");

	// The directory is the single positional after the `upload` command.
	const dir = positionals[0];
	if (!dir) missing.push("<dir>");

	if (missing.length > 0) {
		throw new CliError(`Missing required argument(s): ${missing.join(", ")}`);
	}

	if (positionals.length > 1) {
		throw new CliError(
			`Unexpected extra arguments: ${positionals.slice(1).join(", ")}. ` +
				"Pass exactly one directory.",
		);
	}

	const platform = values.platform;
	if (platform !== "apple" && platform !== "gp") {
		throw new CliError(
			`Invalid --platform "${platform}". Expected "apple" or "gp".`,
		);
	}

	// Non-null assertions are safe: `missing` is empty here, so each was present.
	return {
		apiUrl: values["api-url"],
		appId: values.app!,
		dir: dir!,
		displayType: values["display-type"]!,
		lang: values.lang!,
		platform,
		version: values.version,
	};
}

/**
 * List image files in `dir` (.png/.jpg/.jpeg), sorted by filename so the upload
 * order is stable and predictable — the sort order becomes the display order in
 * the store.
 */
async function listScreenshotFiles(dir: string): Promise<string[]> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		throw new CliError(`Cannot read directory: ${dir}`);
	}

	const files = entries
		.filter(
			(entry) =>
				entry.isFile() &&
				IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()),
		)
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	return files.map((name) => join(dir, name));
}

/**
 * Resolve the version id to upload into. Google Play has no version concept, so
 * its synthetic version is always "default". For Apple we pick the first
 * editable version returned by the API, failing fast when none is editable.
 */
async function resolveVersionId(
	client: AppBoardClient,
	args: UploadArgs,
): Promise<string> {
	if (args.version) return args.version;
	if (args.platform === "gp") return "default";

	const { data, error } = await client.api
		.apps({ appId: args.appId })
		.publishing.versions.get();

	if (error) {
		throw new CliError(
			`Could not list versions for app ${args.appId} ` +
				`(status ${error.status ?? "?"}). Pass --version explicitly.`,
		);
	}

	const editable = data?.versions.find((v) => v.isEditable);
	if (!editable) {
		throw new CliError(
			"No editable App Store version found. Create or select an editable " +
				"version, or pass --version explicitly.",
		);
	}
	return editable.id;
}

/** Read a screenshot file into a `File` the multipart treaty client can upload. */
async function toUploadFile(path: string): Promise<File> {
	const bunFile = Bun.file(path);
	const buffer = await bunFile.arrayBuffer();
	const name = path.slice(path.lastIndexOf("/") + 1);
	const type = MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? "image/png";
	return new File([buffer], name, { type });
}

/** Outcome of processing a single screenshot file. */
interface FileResult {
	error?: string;
	name: string;
	ok: boolean;
}

/**
 * Validate then upload a single screenshot. Validation runs first: a
 * wrong-sized image is reported with the expected dimensions and the API's
 * suggestion, and is never uploaded.
 */
async function processFile(
	client: AppBoardClient,
	args: UploadArgs,
	versionId: string,
	path: string,
): Promise<FileResult> {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const file = await toUploadFile(path);

	const validation = await client.api
		.apps({ appId: args.appId })
		.publishing.screenshots.validate.post({
			displayType: args.displayType,
			file,
		});

	if (validation.error) {
		return {
			error: `validation request failed (status ${validation.error.status ?? "?"})`,
			name,
			ok: false,
		};
	}

	if (!validation.data?.valid) {
		const [w, h] = validation.data?.providedDimensions ?? [0, 0];
		const supported = (validation.data?.supportedDimensions ?? [])
			.map(([sw, sh]) => `${sw}x${sh}`)
			.join(" or ");
		return {
			error:
				`wrong dimensions ${w}x${h} for ${args.displayType}` +
				(supported ? ` (expected ${supported})` : "") +
				(validation.data?.suggestion ? ` — ${validation.data.suggestion}` : ""),
			name,
			ok: false,
		};
	}

	// Re-read the file: the validation request already consumed the body stream.
	// The store preserves upload order, so processing files sequentially in the
	// caller's sorted (filename) order yields the display order.
	const uploadFile = await toUploadFile(path);
	const upload = await client.api
		.apps({ appId: args.appId })
		.publishing.screenshots.upload.post({
			displayType: args.displayType,
			file: uploadFile,
			language: args.lang,
			versionId,
		});

	if (upload.error) {
		const value = upload.error.value;
		const detail =
			typeof value === "string" ? value : JSON.stringify(value ?? {});
		return {
			error: `upload failed (status ${upload.error.status ?? "?"}): ${detail}`,
			name,
			ok: false,
		};
	}

	return { name, ok: true };
}

/**
 * Run the `upload` command. Returns an exit code instead of calling
 * `process.exit` so it stays testable; the `import.meta.main` wrapper maps the
 * code onto the process. User-facing output goes to stdout/stderr — that is the
 * CLI's whole purpose, so direct writes here are intentional.
 */
export async function runUpload(argv: string[]): Promise<ExitCode> {
	let args: UploadArgs;
	try {
		args = parseUploadArgs(argv);
	} catch (err) {
		process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
		return 1;
	}

	let config: ReturnType<typeof loadClientConfig>;
	try {
		config = loadClientConfig(
			args.apiUrl
				? { ...process.env, APPBOARD_API_URL: args.apiUrl }
				: process.env,
		);
	} catch (err) {
		process.stderr.write(`${(err as Error).message}\n`);
		return 1;
	}

	const client = createClient(config);

	let versionId: string;
	let files: string[];
	try {
		[versionId, files] = await Promise.all([
			resolveVersionId(client, args),
			listScreenshotFiles(args.dir),
		]);
	} catch (err) {
		if (err instanceof CliError) {
			process.stderr.write(`${err.message}\n`);
			return 1;
		}
		throw err;
	}

	if (files.length === 0) {
		process.stderr.write(
			`No .png/.jpg/.jpeg screenshots found in ${args.dir}\n`,
		);
		return 1;
	}

	process.stdout.write(
		`Uploading ${files.length} screenshot(s) to app ${args.appId} ` +
			`(${args.platform}, ${args.lang}, ${args.displayType}, version ${versionId})\n`,
	);

	const results: FileResult[] = [];
	for (const path of files) {
		const result = await processFile(client, args, versionId, path);
		results.push(result);
		const mark = result.ok ? "✓" : "✗";
		const suffix = result.ok ? "" : ` — ${result.error}`;
		process.stdout.write(`  ${mark} ${result.name}${suffix}\n`);
	}

	const failed = results.filter((r) => !r.ok).length;
	const succeeded = results.length - failed;
	process.stdout.write(`\nDone: ${succeeded} uploaded, ${failed} failed.\n`);

	return failed === 0 ? 0 : 1;
}

// ── keywords command ──────────────────────────────────────────────────────

const MAX_CLI_KEYWORDS = 10;
const TWO_LETTER_COUNTRY = /^[a-z]{2}$/i;

interface KeywordsArgs {
	apiUrl?: string;
	country: string;
	json: boolean;
	keywords: string[];
	trackId?: string;
}

/**
 * Parse and validate the `keywords` command arguments. Keywords may be given
 * comma-separated in one argument, as separate positionals, or both.
 */
function parseKeywordsArgs(argv: string[]): KeywordsArgs {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		args: argv,
		options: {
			"api-url": { type: "string" },
			country: { type: "string" },
			json: { type: "boolean" },
			"track-id": { type: "string" },
		},
	});

	const country = values.country;
	if (!country) {
		throw new CliError("Missing required argument: --country");
	}
	if (!TWO_LETTER_COUNTRY.test(country)) {
		throw new CliError(
			`Invalid --country "${country}". Expected a two-letter code, e.g. us.`,
		);
	}

	const keywords = [
		...new Set(
			positionals
				.flatMap((p) => p.split(","))
				.map((k) => k.trim().toLowerCase())
				.filter(Boolean),
		),
	];
	if (keywords.length === 0) {
		throw new CliError("Provide at least one keyword.");
	}
	if (keywords.length > MAX_CLI_KEYWORDS) {
		throw new CliError(
			`Too many keywords (${keywords.length}). The limit is ${MAX_CLI_KEYWORDS} per run.`,
		);
	}

	return {
		apiUrl: values["api-url"],
		country: country.toLowerCase(),
		json: values.json ?? false,
		keywords,
		trackId: values["track-id"],
	};
}

/** Pad or truncate a cell to a fixed width (left-aligned). */
function cell(value: string, width: number): string {
	const text =
		value.length > width
			? `${value.slice(0, Math.max(width - 2, 1))}..`
			: value;
	return text.padEnd(width);
}

/** Compact low-high range, e.g. "12-48" or "0.4-1.7". */
function range(low: number, high: number): string {
	const fmt = (v: number) =>
		v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
	return `${fmt(low)}-${fmt(high)}`;
}

/** Render one scored keyword as a table row. */
function keywordRow(score: KeywordScore, withRank: boolean): string {
	if (score.error) {
		return `${cell(score.keyword, 24)} error: ${score.error}`;
	}
	const top1 = score.downloads.positions[0];
	const columns = [
		cell(score.keyword, 24),
		cell(score.popularity === null ? "-" : String(score.popularity), 4),
		cell(String(score.difficulty), 5),
		cell(score.difficultyLabel, 10),
		cell(String(score.opportunity), 4),
		cell(score.classification, 17),
		cell(top1 ? range(top1.low, top1.high) : "-", 13),
	];
	if (withRank) {
		columns.push(cell(score.appRank ? `#${score.appRank}` : "-", 5));
	}
	return columns.join(" ").trimEnd();
}

/**
 * Run the `keywords` command: score keywords through the backend and print a
 * compact table (or the raw JSON with --json). Returns an exit code.
 */
export async function runKeywords(argv: string[]): Promise<ExitCode> {
	let args: KeywordsArgs;
	try {
		args = parseKeywordsArgs(argv);
	} catch (err) {
		process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
		return 1;
	}

	let config: ReturnType<typeof loadClientConfig>;
	try {
		config = loadClientConfig(
			args.apiUrl
				? { ...process.env, APPBOARD_API_URL: args.apiUrl }
				: process.env,
		);
	} catch (err) {
		process.stderr.write(`${(err as Error).message}\n`);
		return 1;
	}

	const client = createClient(config);
	const { data, error } = await client.api.research["keyword-scores"].post({
		appstoreId: args.trackId,
		country: args.country,
		keywords: args.keywords,
	});

	if (error || !data) {
		const value = error?.value;
		const detail =
			typeof value === "string" ? value : JSON.stringify(value ?? {});
		process.stderr.write(
			`Keyword scoring failed (status ${error?.status ?? "?"}): ${detail}\n`,
		);
		return 1;
	}

	const scores = data.scores as KeywordScore[];

	if (args.json) {
		process.stdout.write(`${JSON.stringify(scores, null, 2)}\n`);
		return scores.some((s) => s.error) ? 1 : 0;
	}

	const withRank = Boolean(args.trackId);
	process.stdout.write(
		`Keyword scores (${args.country.toUpperCase()}, downloads/day at #1 as low-high):\n\n`,
	);
	const header = [
		cell("KEYWORD", 24),
		cell("POP", 4),
		cell("DIFF", 5),
		cell("LABEL", 10),
		cell("OPP", 4),
		cell("CLASS", 17),
		cell("DL/DAY #1", 13),
	];
	if (withRank) header.push(cell("RANK", 5));
	process.stdout.write(`${header.join(" ").trimEnd()}\n`);
	for (const score of scores) {
		process.stdout.write(`${keywordRow(score, withRank)}\n`);
	}

	const failed = scores.filter((s) => s.error).length;
	if (failed > 0) {
		process.stdout.write(`\n${failed} keyword(s) failed to score.\n`);
		return 1;
	}
	return 0;
}

/**
 * Top-level dispatcher. Returns an exit code. `--help`/`-h` and an
 * unknown/missing command print usage.
 */
export async function run(argv: string[]): Promise<ExitCode> {
	const [command, ...rest] = argv;

	if (command === "-h" || command === "--help" || command === "help") {
		process.stdout.write(USAGE);
		return 0;
	}

	if (command === "upload") {
		return runUpload(rest);
	}

	if (command === "keywords") {
		return runKeywords(rest);
	}

	process.stderr.write(
		command
			? `Unknown command: ${command}\n\n${USAGE}`
			: `No command provided.\n\n${USAGE}`,
	);
	return 1;
}

if (import.meta.main) {
	run(process.argv.slice(2)).then((code) => process.exit(code));
}
