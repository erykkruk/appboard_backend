import Elysia from "elysia";
import { buildError } from "@/utils/errors";
import { matchesPathPattern, ROUTE_FEATURE_MAP } from "./features.const";
import { FeaturesService } from "./features.service";

const FEATURES_ENDPOINT_SEGMENT = "/api/features";

export const featureGuard = new Elysia({
	name: "feature-guard",
}).onBeforeHandle(
	{ as: "scoped" },
	async ({
		request,
		workspaceId,
	}: {
		request: Request;
		workspaceId: string | null;
	}) => {
		if (!workspaceId) return;

		const { pathname } = new URL(request.url);

		// Skip the features endpoint itself to avoid recursion/self-locking
		if (
			pathname === FEATURES_ENDPOINT_SEGMENT ||
			pathname.startsWith(`${FEATURES_ENDPOINT_SEGMENT}/`)
		) {
			return;
		}

		const match = ROUTE_FEATURE_MAP.find(({ pattern }) =>
			matchesPathPattern(pathname, pattern),
		);
		if (!match) return;

		const enabled = await FeaturesService.isEnabled(workspaceId, match.feature);
		if (!enabled) {
			buildError("forbidden", {
				info: `Feature ${match.feature} is disabled`,
			});
		}
	},
);
