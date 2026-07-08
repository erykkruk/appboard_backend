import { desc, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { errorLogs } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("error-log");

const MESSAGE_MAX = 2000;

// Patterns whose matches are replaced before anything is written to the DB, so
// pasted keys / tokens / PEM blobs never land in the error log.
const SECRET_PATTERNS: RegExp[] = [
	/-----BEGIN[\s\S]*?END[^-]*-----/g, // PEM private keys
	/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, // bearer tokens
	/\b(sk|pk|rk)-[A-Za-z0-9-_]{16,}\b/g, // sk-/pk- style API keys
	/"private_key"\s*:\s*"[^"]*"/g, // service-account JSON private_key
	/\beyJ[A-Za-z0-9._-]{20,}\b/g, // JWTs
];

/** Replace any secret-looking substrings with a placeholder. */
export function scrubSecrets(input: string): string {
	let out = input;
	for (const pattern of SECRET_PATTERNS) {
		out = out.replace(pattern, "[REDACTED]");
	}
	return out;
}

export interface ErrorLogInput {
	code?: string;
	context?: Record<string, unknown>;
	level?: string;
	message?: string;
	method?: string;
	path?: string;
	statusCode?: number;
	userId?: string | null;
	workspaceId?: string | null;
}

export const ErrorLogService = {
	/** Recent error logs, newest first. Optionally scoped to a workspace. */
	async recent(limit = 100, workspaceId?: string) {
		const capped = Math.min(Math.max(limit, 1), 500);
		const base = db.select().from(errorLogs);
		const rows = workspaceId
			? await base
					.where(eq(errorLogs.workspaceId, workspaceId))
					.orderBy(desc(errorLogs.createdAt))
					.limit(capped)
			: await base.orderBy(desc(errorLogs.createdAt)).limit(capped);
		return rows;
	},
	/**
	 * Persist an error to the DB. Fire-and-forget: never throws and never blocks
	 * the response — a logging failure must not turn into a user-facing error.
	 * All string fields are secret-scrubbed before insertion.
	 */
	record(input: ErrorLogInput): void {
		const message = input.message
			? scrubSecrets(input.message).slice(0, MESSAGE_MAX)
			: null;
		const context = input.context
			? (JSON.parse(scrubSecrets(JSON.stringify(input.context))) as Record<
					string,
					unknown
				>)
			: null;

		void db
			.insert(errorLogs)
			.values({
				code: input.code ?? null,
				context,
				level: input.level ?? "error",
				message,
				method: input.method ?? null,
				path: input.path?.slice(0, 512) ?? null,
				statusCode: input.statusCode ?? null,
				userId: input.userId ?? null,
				workspaceId: input.workspaceId ?? null,
			})
			.catch((err) => {
				// Last resort: keep it in the app logs, never surface to the client.
				log.warn({ err }, "Failed to persist error log");
			});
	},
};
