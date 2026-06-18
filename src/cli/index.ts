import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import type { AppBoardClient } from "@/mcp/client";
import { createClient, loadClientConfig } from "@/mcp/client";

/**
 * Standalone CLI for uploading a folder of screenshots to the AppBoard API —
 * the web-based equivalent of ButterKit's Fastlane-folder upload, intended for
 * CI pipelines. Each image is validated against the display type's accepted
 * dimensions before upload, so a wrong-sized asset fails fast with an
 * actionable message instead of being silently distorted.
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

const USAGE = `appboard — upload screenshots to the AppBoard API

Usage:
  appboard upload --app <appId> --lang <locale> --platform <apple|gp> \\
    --display-type <type> [--version <versionId>] [--api-url <url>] <dir>

Arguments:
  <dir>                  Directory containing screenshots (.png/.jpg/.jpeg)

Options:
  --app <appId>          App UUID (required)
  --lang <locale>        Listing locale, e.g. en-US (required)
  --platform <apple|gp>  Target platform: apple (App Store) or gp (Google Play) (required)
  --display-type <type>  Display type the screenshots target (required, see below)
  --version <versionId>  Version to upload into. Defaults to the first editable
                         version (Apple) or "default" (Google Play)
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

/**
 * Top-level dispatcher. Returns an exit code; only the `upload` command exists
 * today. `--help`/`-h` and an unknown/missing command print usage.
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
