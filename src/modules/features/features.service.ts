import { and, eq, like } from "drizzle-orm";
import { isCloud } from "@/config/deployment";
import { db } from "@/utils/db";
import { settings } from "@/utils/db/schema";
import {
	FEATURE_DEFINITIONS,
	FEATURE_PREFIX,
	type FeatureKey,
} from "./features.const";

function storageKey(key: FeatureKey): string {
	return `${FEATURE_PREFIX}${key}`;
}

function parseValue(value: string | null): boolean | null {
	if (value === "true") return true;
	if (value === "false") return false;
	return null;
}

/**
 * Apply cascading dependsOn rules to a feature map. If any dependency of a
 * feature is disabled, the feature itself is forced disabled. Mutates and
 * returns the input map.
 */
function applyDependencyCascade(
	features: Record<FeatureKey, boolean>,
): Record<FeatureKey, boolean> {
	for (const def of FEATURE_DEFINITIONS) {
		if (!def.dependsOn || def.dependsOn.length === 0) continue;
		const allDepsEnabled = def.dependsOn.every((dep) => features[dep]);
		if (!allDepsEnabled) features[def.key] = false;
	}
	return features;
}

/**
 * Force cloud-only features off on self-hosted deployments, regardless of any
 * stored toggle. Mirrors the dependency cascade. No-op on our cloud.
 */
function applyDeploymentMode(
	features: Record<FeatureKey, boolean>,
): Record<FeatureKey, boolean> {
	if (isCloud()) return features;
	for (const def of FEATURE_DEFINITIONS) {
		if (def.cloudOnly) features[def.key] = false;
	}
	return features;
}

export class FeaturesService {
	static async getAll(
		workspaceId: string,
	): Promise<Record<FeatureKey, boolean>> {
		const rows = await db
			.select()
			.from(settings)
			.where(
				and(
					eq(settings.workspaceId, workspaceId),
					like(settings.key, `${FEATURE_PREFIX}%`),
				),
			);

		const stored = new Map<string, boolean>();
		for (const row of rows) {
			const parsed = parseValue(row.value);
			if (parsed !== null) stored.set(row.key, parsed);
		}

		const result = {} as Record<FeatureKey, boolean>;
		for (const def of FEATURE_DEFINITIONS) {
			const key = storageKey(def.key);
			const value = stored.get(key);
			result[def.key] = value ?? def.defaultEnabled;
		}

		return applyDeploymentMode(applyDependencyCascade(result));
	}

	static async isEnabled(
		workspaceId: string,
		key: FeatureKey,
	): Promise<boolean> {
		const all = await FeaturesService.getAll(workspaceId);
		return all[key] ?? true;
	}

	static async toggle(
		workspaceId: string,
		key: FeatureKey,
		enabled: boolean,
	): Promise<void> {
		const k = storageKey(key);
		const value = enabled ? "true" : "false";

		const existing = await db
			.select()
			.from(settings)
			.where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)))
			.limit(1);

		if (existing.length > 0) {
			await db
				.update(settings)
				.set({ isEncrypted: false, value })
				.where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)));
		} else {
			await db.insert(settings).values({
				isEncrypted: false,
				key: k,
				value,
				workspaceId,
			});
		}
	}

	static async setAll(
		workspaceId: string,
		features: Partial<Record<FeatureKey, boolean>>,
	): Promise<Record<FeatureKey, boolean>> {
		const validKeys = new Set(FEATURE_DEFINITIONS.map((d) => d.key));

		await db.transaction(async (tx) => {
			for (const [key, enabled] of Object.entries(features)) {
				if (!validKeys.has(key as FeatureKey)) continue;
				if (typeof enabled !== "boolean") continue;

				const k = storageKey(key as FeatureKey);
				const value = enabled ? "true" : "false";

				const existing = await tx
					.select()
					.from(settings)
					.where(
						and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)),
					)
					.limit(1);

				if (existing.length > 0) {
					await tx
						.update(settings)
						.set({ isEncrypted: false, value })
						.where(
							and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)),
						);
				} else {
					await tx.insert(settings).values({
						isEncrypted: false,
						key: k,
						value,
						workspaceId,
					});
				}
			}
		});

		return FeaturesService.getAll(workspaceId);
	}
}
