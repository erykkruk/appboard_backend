import Elysia from "elysia";
import { ROUTE_CAPABILITY_MAP } from "@/config/store-capabilities";
import { authGuard } from "@/modules/auth";
import { matchesPathPattern } from "@/modules/features/features.const";
import { buildError } from "@/utils/errors";
import { StoreCapabilitiesService } from "./store-capabilities.service";

/** Extract the `:appId` segment from an `/api/apps/:appId/...` pathname. */
export function appIdFromPath(pathname: string): string | null {
	const segments = pathname.split("/").filter(Boolean);
	const appsIndex = segments.indexOf("apps");
	if (appsIndex === -1) return null;
	return segments[appsIndex + 1] ?? null;
}

/**
 * Per-connection capability gate. When a connection's owner opted out of a
 * gateable capability (e.g. purchases), the matching routes return 403 for that
 * store's apps. Connections with no explicit selection keep full access.
 */
export const storeCapabilityGuard = new Elysia({
	name: "store-capability-guard",
})
	.use(authGuard)
	.onBeforeHandle({ as: "scoped" }, async ({ request, workspaceId }) => {
		if (!workspaceId) return;

		const { pathname } = new URL(request.url);
		const match = ROUTE_CAPABILITY_MAP.find(({ pattern }) =>
			matchesPathPattern(pathname, pattern),
		);
		if (!match) return;

		const appId = appIdFromPath(pathname);
		if (!appId) return;

		const resolved = await StoreCapabilitiesService.getForApp(appId);
		// Unknown app → let the route's ownership check surface the 404.
		if (!resolved) return;

		// Public (link) connections have no store API behind them: block
		// publishing/purchases mutations with the upgrade-flavored 403 the panel
		// turns into a "connect your store API" CTA. Reads (GET) stay open —
		// they serve cached/local data. Reviews are not gated here because the
		// public review sync genuinely works; only replying fails, with the same
		// typed error raised by the provider.
		if (
			resolved.connectionMode === "public" &&
			request.method !== "GET" &&
			(match.capability === "publishing" || match.capability === "purchases")
		) {
			buildError("integrationRequired", {
				info: "This app was added from a public store link. Connect your store API to publish changes.",
			});
		}

		if (!resolved.capabilities.includes(match.capability)) {
			buildError("forbidden", {
				info: `Capability "${match.capability}" is not enabled for this store connection.`,
			});
		}
	});
