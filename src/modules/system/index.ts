import { eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import config from "@/config";
import { ErrorLogService } from "@/modules/system/error-log.service";
import { db } from "@/utils/db";
import { runMigrations } from "@/utils/db/migrate";
import { user } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import packageJson from "../../../package.json";

const log = createLogger("system");

const version: string = packageJson.version;

export async function bootstrap() {
	log.info("Bootstrapping application...");
	await runMigrations();
	await ensureBootstrapAdmin();
	log.info("Bootstrap complete");
}

/**
 * Self-hosting convenience: when ADMIN_EMAIL + ADMIN_PASSWORD are set (e.g. a
 * one-click deploy without SMTP), create an owner account on first boot so the
 * operator can log in with email + password. Idempotent and best-effort.
 */
async function ensureBootstrapAdmin() {
	const email = config.ADMIN_EMAIL;
	const password = config.ADMIN_PASSWORD;
	if (!email || !password) return;

	const existing = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	if (existing.length > 0) {
		log.info({ email }, "Bootstrap admin already exists — skipping");
		return;
	}

	try {
		// signUpEmail creates the user + a hashed-password credential account and
		// fires the workspace-create hook.
		const { auth } = await import("@/config/auth");
		await auth.api.signUpEmail({ body: { email, name: "Admin", password } });
		log.info({ email }, "Bootstrap admin created (email + password login)");
	} catch (err) {
		log.error({ email, err }, "Failed to create bootstrap admin");
	}
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
