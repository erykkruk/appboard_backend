import Elysia, { t } from "elysia";
import { getDeploymentMode, isCloud } from "@/config/deployment";
import { FEATURE_DEFINITIONS } from "./features.const";
import { FeaturesService } from "./features.service";

export const featuresController = new Elysia({ prefix: "/features" })
	.get(
		"",
		async ({ workspaceId }) => {
			const features = await FeaturesService.getAll(workspaceId!);
			// Hide cloud-only definitions on self-hosted deployments.
			const definitions = isCloud()
				? FEATURE_DEFINITIONS
				: FEATURE_DEFINITIONS.filter((d) => !d.cloudOnly);
			return {
				definitions,
				deploymentMode: getDeploymentMode(),
				features,
			};
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
