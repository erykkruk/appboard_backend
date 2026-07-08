import Elysia, { t } from "elysia";
import { ErrorLogService } from "@/modules/system/error-log.service";
import { runMigrations } from "@/utils/db/migrate";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import packageJson from "../../../package.json";

const log = createLogger("system");

const version: string = packageJson.version;

export async function bootstrap() {
	log.info("Bootstrapping application...");
	await runMigrations();
	log.info("Bootstrap complete");
}

export const systemController = new Elysia({ prefix: "/system" })
	.get(
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
	)
	.get(
		"/logs",
		async ({ query, workspaceId }) => {
			if (!workspaceId) buildError("unauthorized", { info: "Auth required" });
			const parsed = query.limit ? Number.parseInt(query.limit, 10) : 100;
			const logs = await ErrorLogService.recent(
				Number.isFinite(parsed) ? parsed : 100,
			);
			return { logs };
		},
		{
			detail: {
				description: "Recent persisted error logs (newest first)",
				tags: ["System"],
			},
			query: t.Object({ limit: t.Optional(t.String()) }),
		},
	);
