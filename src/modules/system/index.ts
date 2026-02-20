import Elysia from "elysia";
import { runMigrations } from "@/utils/db/migrate";
import { createLogger } from "@/utils/logger";

const log = createLogger("system");

const version = "0.1.0";

export async function bootstrap() {
	log.info("Bootstrapping application...");
	await runMigrations();
	log.info("Bootstrap complete");
}

export const systemController = new Elysia({ prefix: "/system" }).get(
	"/health",
	() => ({
		status: "ok",
		uptime: process.uptime(),
		version,
	}),
	{
		detail: {
			description: "Health check endpoint",
			tags: ["System"],
		},
	},
);
