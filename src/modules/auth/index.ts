import { eq } from "drizzle-orm";
import Elysia from "elysia";
import config from "@/config";
import { auth } from "@/config/auth";
import { db } from "@/utils/db";
import { workspaceMembers } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { ApiKeysService } from "./api-keys.service";

const PUBLIC_PREFIXES = ["/api/auth", "/api/system/health"];
const isDev = config.NODE_ENV !== "production";

// API key management lives under /api/auth/* but is NOT public — it must run
// through the guard so it can require a real session and reject bearer auth.
const NON_PUBLIC_AUTH_PATHS = ["/api/auth/api-keys"];

const BEARER_PREFIX = "Bearer ";

function isPublicPath(path: string): boolean {
	if (NON_PUBLIC_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`)))
		return false;
	return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const authGuard = new Elysia({ name: "auth-guard" }).derive(
	{ as: "scoped" },
	async ({
		request,
	}): Promise<{ userId: string | null; workspaceId: string | null }> => {
		const url = new URL(request.url);
		if (isPublicPath(url.pathname)) {
			return { userId: null, workspaceId: null };
		}

		// Test bypass: allow X-Test-User-Id header in dev/test mode
		const testUserId = request.headers.get("x-test-user-id");
		if (isDev && testUserId) {
			const [membership] = await db
				.select()
				.from(workspaceMembers)
				.where(eq(workspaceMembers.userId, testUserId))
				.limit(1);

			if (!membership) {
				buildError("unauthorized", {
					info: "No workspace found for test user",
				});
			}

			return {
				userId: testUserId,
				workspaceId: membership.workspaceId,
			};
		}

		// Machine clients (MCP server, CLI) authenticate with a bearer API key.
		// A valid, non-revoked key resolves to its workspace; userId stays null
		// so downstream endpoints scope by workspaceId alone.
		const authHeader = request.headers.get("authorization");
		if (authHeader?.startsWith(BEARER_PREFIX)) {
			const token = authHeader.slice(BEARER_PREFIX.length).trim();
			const apiKey = token ? await ApiKeysService.resolveToken(token) : null;
			if (!apiKey) {
				buildError("unauthorized", { info: "Invalid API key" });
			}
			return { userId: null, workspaceId: apiKey.workspaceId };
		}

		const session = await auth.api.getSession({
			headers: request.headers,
		});
		if (!session) {
			buildError("unauthorized", { info: "Not authenticated" });
		}

		const [membership] = await db
			.select()
			.from(workspaceMembers)
			.where(eq(workspaceMembers.userId, session.user.id))
			.limit(1);

		if (!membership) {
			buildError("unauthorized", {
				info: "No workspace found for user",
			});
		}

		return {
			userId: session.user.id,
			workspaceId: membership.workspaceId,
		};
	},
);
