import Elysia from "elysia";
import { authGuard } from "@/modules/auth";
import { BulkCopyService } from "./bulk.service";
import { bulkCopyBody } from "./bulk.types";

export const bulkController = new Elysia({ prefix: "/apps" })
	.use(authGuard)
	.post(
		"/bulk-copy/preview",
		async ({ body, workspaceId }) =>
			await BulkCopyService.preview(body, workspaceId!),
		{
			body: bulkCopyBody,
			detail: {
				description:
					"Dry run of a bulk copy: the exact before/after rows that applying the same body would write onto each target, plus the targets and parts that would be skipped and why. Writes nothing. Every app id must belong to the workspace, otherwise the whole request is rejected with 404.",
				tags: ["Bulk"],
			},
		},
	)
	.post(
		"/bulk-copy",
		async ({ body, workspaceId }) =>
			await BulkCopyService.apply(body, workspaceId!),
		{
			body: bulkCopyBody,
			detail: {
				description:
					"Copy selected parts (about, privacy, ageRating, keywords, prompts, listings) from one app onto up to 50 other apps in the workspace. Only local AppBoard data is written - listings land on the target's draft and nothing is pushed to a store. Each target x part is applied independently, so one failure never stops the others.",
				tags: ["Bulk"],
			},
		},
	);
