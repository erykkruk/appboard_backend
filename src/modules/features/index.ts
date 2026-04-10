import Elysia, { t } from "elysia";
import { FEATURE_DEFINITIONS } from "./features.const";
import { FeaturesService } from "./features.service";

export const featuresController = new Elysia({ prefix: "/features" })
	.get(
		"",
		async ({ workspaceId }) => {
			const features = await FeaturesService.getAll(workspaceId!);
			return { definitions: FEATURE_DEFINITIONS, features };
		},
		{
			detail: {
				description: "Get all feature flags + definitions",
				tags: ["Features"],
			},
		},
	)
	.patch(
		"",
		async ({ body, workspaceId }) => {
			const features = await FeaturesService.setAll(workspaceId!, body);
			return { features };
		},
		{
			body: t.Record(t.String(), t.Boolean()),
			detail: {
				description: "Bulk update feature flags",
				tags: ["Features"],
			},
		},
	);
