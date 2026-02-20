import { migrate } from "drizzle-orm/bun-sql/migrator";
import { createLogger } from "@/utils/logger";
import { db } from "./index";

const log = createLogger("migrate");

export async function runMigrations() {
	log.info("Running migrations...");
	await migrate(db, { migrationsFolder: "./src/utils/db/drizzle" });
	log.info("Migrations complete");
}
