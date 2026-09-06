import Elysia from "elysia";
import { authGuard } from "@/modules/auth";
import { OverviewService } from "./overview.service";

export const overviewController = new Elysia({ prefix: "/overview" })
	.use(authGuard)
	.get("", async ({ workspaceId }) => OverviewService.get(workspaceId!), {
		detail: {
			description:
				"Workspace dashboard: one row per app with store rating, review backlog, audit scores and tracked-keyword rank stats, plus workspace totals. Read-only, local data only - never calls a store.",
			tags: ["Overview"],
		},
	});
