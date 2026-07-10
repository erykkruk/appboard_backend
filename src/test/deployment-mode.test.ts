import { afterEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import config from "@/config";
import { getDeploymentMode, isCloud, isSelfHosted } from "@/config/deployment";
import { authGuard } from "@/modules/auth";
import { featuresController } from "@/modules/features";
import {
	FEATURE_DEFINITIONS,
	type FeatureDefinition,
} from "@/modules/features/features.const";
import { featureGuard } from "@/modules/features/features.guard";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authRequest } from "./setup";

describe("Deployment mode (cloud vs self-hosted)", () => {
	const app = new Elysia()
		.use(errorHandler)
		.use(authGuard)
		.group("/api", (a) => a.use(featuresController).use(featureGuard));

	const originalMode = config.DEPLOYMENT_MODE;
	afterEach(() => {
		config.DEPLOYMENT_MODE = originalMode;
	});

	it("defaults to self-hosted", () => {
		config.DEPLOYMENT_MODE = undefined;
		expect(getDeploymentMode()).toBe("selfhosted");
		expect(isSelfHosted()).toBe(true);
		expect(isCloud()).toBe(false);
	});

	it("is cloud only when DEPLOYMENT_MODE is exactly 'cloud'", () => {
		config.DEPLOYMENT_MODE = "cloud";
		expect(isCloud()).toBe(true);
		// Fail-safe: any other value (typo, casing) falls back to self-hosted.
		config.DEPLOYMENT_MODE = "Cloud";
		expect(getDeploymentMode()).toBe("selfhosted");
		config.DEPLOYMENT_MODE = "prod";
		expect(getDeploymentMode()).toBe("selfhosted");
	});

	it("GET /api/features returns the deployment mode", async () => {
		config.DEPLOYMENT_MODE = "cloud";
		const res = await app.handle(authRequest("http://localhost/api/features"));
		const data = (await res.json()) as { deploymentMode: string };
		expect(data.deploymentMode).toBe("cloud");
	});

	it("hides and force-disables cloud-only features when self-hosted", async () => {
		// Temporarily flag a leaf feature as cloud-only.
		const def = FEATURE_DEFINITIONS.find(
			(d) => d.key === "REVIEWS",
		) as FeatureDefinition;
		def.cloudOnly = true;
		try {
			config.DEPLOYMENT_MODE = "selfhosted";
			const shRes = await app.handle(authRequest("http://localhost/api/features"));
			const sh = (await shRes.json()) as {
				definitions: FeatureDefinition[];
				features: Record<string, boolean>;
			};
			expect(sh.definitions.some((d) => d.key === "REVIEWS")).toBe(false);
			expect(sh.features.REVIEWS).toBe(false);

			config.DEPLOYMENT_MODE = "cloud";
			const clRes = await app.handle(authRequest("http://localhost/api/features"));
			const cl = (await clRes.json()) as {
				definitions: FeatureDefinition[];
				features: Record<string, boolean>;
			};
			expect(cl.definitions.some((d) => d.key === "REVIEWS")).toBe(true);
			expect(cl.features.REVIEWS).toBe(true);
		} finally {
			def.cloudOnly = undefined;
		}
	});
});
