import config from "@/config";

export const DEPLOYMENT_MODES = ["cloud", "selfhosted"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/**
 * Resolve the deployment edition. Fail-safe by design: only an explicit
 * `DEPLOYMENT_MODE=cloud` unlocks cloud-only features — anything else (unset,
 * a typo, or a self-hosted image) is treated as self-hosted, so cloud-only
 * surfaces (e.g. billing) never leak into a self-hosted deployment.
 */
export function getDeploymentMode(): DeploymentMode {
	return config.DEPLOYMENT_MODE === "cloud" ? "cloud" : "selfhosted";
}

export function isCloud(): boolean {
	return getDeploymentMode() === "cloud";
}

export function isSelfHosted(): boolean {
	return !isCloud();
}
