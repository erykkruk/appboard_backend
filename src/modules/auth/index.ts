import { eq } from "drizzle-orm";
import Elysia from "elysia";
import config from "@/config";
import { auth } from "@/config/auth";
import { db } from "@/utils/db";
import { workspaceMembers } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

const PUBLIC_PREFIXES = ["/api/auth", "/api/system/health"];
const isDev = config.NODE_ENV !== "production";

function isPublicPath(path: string): boolean {
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
