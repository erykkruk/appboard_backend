import { migrate } from "drizzle-orm/bun-sql/migrator";
import { createLogger } from "@/utils/logger";
import { db } from "./index";

const log = createLogger("migrate");

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 2000;

const CONNECTION_ERROR_PATTERNS = [
	"connection closed",
	"connection refused",
	"connection terminated",
	"econnrefused",
	"econnreset",
	"enotfound",
	"etimedout",
	"timeout",
	"the database system is starting up",
];

export function isConnectionError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const err = error as { cause?: unknown; code?: string; message?: string };
	const haystack = `${err.code ?? ""} ${err.message ?? ""}`.toLowerCase();
	if (CONNECTION_ERROR_PATTERNS.some((p) => haystack.includes(p))) return true;
	return err.cause ? isConnectionError(err.cause) : false;
}

// On one-click platforms (Easypanel, Dokploy, Coolify) the backend container
// often starts before Postgres accepts connections — without a retry the boot
// crash-loops with "Connection closed" and the deploy fails its smoke test.
export async function runMigrations() {
	log.info("Running database migrations...");
	for (let attempt = 1; ; attempt++) {
		try {
			await migrate(db, {
				migrationsFolder: "./src/utils/db/drizzle",
			});
			break;
		} catch (error) {
			if (attempt >= MAX_ATTEMPTS || !isConnectionError(error)) throw error;
			log.warn(
				{ attempt, maxAttempts: MAX_ATTEMPTS },
				"Database not reachable yet — retrying migrations shortly",
			);
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		}
	}
	log.info("Database migrations complete");
}
