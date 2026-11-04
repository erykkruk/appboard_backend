import Elysia from "elysia";
import { authGuard } from "@/modules/auth";
import { dailySummaryPatchBody } from "./daily-summary.schema";
import { DailySummaryService } from "./daily-summary.service";

// Under /tracking so the RESEARCH feature flag gates it like the rest of the
// automations (ROUTE_FEATURE_MAP matches the "/tracking" segment).
export const dailySummaryController = new Elysia({
	prefix: "/tracking/daily-summary",
})
	.use(authGuard)
	.get(
		"/",
		async ({ workspaceId }) => DailySummaryService.getSettings(workspaceId!),
		{
			detail: {
				description:
					"Workspace daily summary email: enabled, recipient (set and effective), schedule, last send and how many apps it covers",
				tags: ["Tracking"],
			},
		},
	)
	.patch(
		"/",
		async ({ body, workspaceId }) =>
			DailySummaryService.updateSettings(workspaceId!, body),
		{
			body: dailySummaryPatchBody,
			detail: {
				description:
					"Turn the workspace daily summary on/off or set its recipient. While on, it replaces the per-app rank digests and research reports.",
				tags: ["Tracking"],
			},
		},
	)
	.post(
		"/test",
		async ({ workspaceId }) => DailySummaryService.sendTest(workspaceId!),
		{
			detail: {
				description:
					"Send the daily summary now to the configured recipient (does not count as today's scheduled summary)",
				tags: ["Tracking"],
			},
		},
	);
