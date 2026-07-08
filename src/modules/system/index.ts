import Elysia from "elysia";
import { runMigrations } from "@/utils/db/migrate";
import { createLogger } from "@/utils/logger";
import packageJson from "../../../package.json";

const log = createLogger("system");

const version: string = packageJson.version;

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
