import { eq, inArray } from "drizzle-orm";
import { AgeRatingService } from "@/modules/age-rating/age-rating.service";
import { AppAiPromptsService } from "@/modules/app-ai-prompts/app-ai-prompts.service";
import { AppGroupsService } from "@/modules/app-groups/app-groups.service";
import { AsoProfileService } from "@/modules/aso-profile/aso-profile.service";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { ListingsService } from "@/modules/listings/listings.service";
import { PrivacyDeclarationService } from "@/modules/privacy-declaration/privacy-declaration.service";
import { TrackingService } from "@/modules/tracking/tracking.service";
import { MAX_KEYWORDS_PER_COUNTRY } from "@/modules/tracking/tracking.types";
import { db } from "@/utils/db";
import { apps, listings } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";
import {
	type BulkCopyApplyResponse,
	type BulkCopyChange,
	type BulkCopyPart,
	type BulkCopyPreview,
	type BulkCopyRequest,
	type BulkCopyResult,
	type BulkCopySkip,
	LISTING_COPY_FIELDS,
} from "./bulk.types";

const log = createLogger("bulk");

const ALREADY_IDENTICAL = "Already identical";

interface AppRef {
	id: string;
	name: string;
	platform: string;
}

/**
 * One target x one part. Preview and apply are built from the same plan so the
 * rows the user approves are exactly the writes that happen.
 */
interface PartPlan {
	changes: BulkCopyChange[];
	skipped: string[];
	write: () => Promise<void>;
}

type ListingRow = typeof listings.$inferSelect;
type SourceData = unknown;

type ChangeInput = Omit<BulkCopyChange, "appId" | "appName" | "part">;

function display(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") return value;
	if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
		return value.join(", ");
	}
	return JSON.stringify(value);
}

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** buildError() throws an Elysia status object, so `.message` alone is not enough. */
function describeError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	const response = (error as { response?: unknown } | null)?.response as
		| { code?: string; data?: { info?: string } }
		| undefined;
	if (response?.data?.info) return response.data.info;
	if (response?.code) return response.code;
	return String(error);
}

function stripProfileMeta<
	T extends { appId: string; createdAt: Date; id: string; updatedAt: Date },
>(row: T): Omit<T, "appId" | "createdAt" | "id" | "updatedAt"> {
	const {
		id: _id,
		appId: _appId,
		createdAt: _createdAt,
		updatedAt: _updatedAt,
		...data
	} = row;
	return data;
}

function planFor(
	target: AppRef,
	part: BulkCopyPart,
	changes: ChangeInput[],
	skipped: string[],
	write: () => Promise<void>,
): PartPlan {
	return {
		changes: changes.map((change) => ({
			...change,
			appId: target.id,
			appName: target.name,
			part,
		})),
		skipped,
		write,
	};
}

function skipPlan(target: AppRef, part: BulkCopyPart, reason: string) {
	return planFor(target, part, [], [reason], async () => {});
}

/** Draft wins over remote: it is what the user currently sees in the editor. */
function effectiveListings(rows: ListingRow[]): Map<string, ListingRow> {
	const byLanguage = new Map<string, ListingRow>();
	for (const row of rows) {
		const current = byLanguage.get(row.language);
		if (!current || (current.source !== "draft" && row.source === "draft")) {
			byLanguage.set(row.language, row);
		}
	}
	return byLanguage;
}

export class BulkCopyService {
	static async preview(
		request: BulkCopyRequest,
		workspaceId: string,
	): Promise<BulkCopyPreview> {
		const { source, targets, skipped } = await BulkCopyService.resolveApps(
			request,
			workspaceId,
		);
		const changes: BulkCopyChange[] = [];

		for (const part of BulkCopyService.uniqueParts(request.parts)) {
			const sourceData = await BulkCopyService.loadSource(part, source);
			for (const target of targets) {
				const plan = await BulkCopyService.buildPlan(
					part,
					source,
					sourceData,
					target,
				);
				changes.push(...plan.changes);
				const reasons =
					plan.changes.length === 0 && plan.skipped.length === 0
						? [ALREADY_IDENTICAL]
						: plan.skipped;
				for (const reason of reasons) {
					skipped.push({
						appId: target.id,
						appName: target.name,
						part,
						reason,
					});
				}
			}
		}

		return { changes, skipped };
	}

	static async apply(
		request: BulkCopyRequest,
		workspaceId: string,
	): Promise<BulkCopyApplyResponse> {
		const { source, targets, skipped } = await BulkCopyService.resolveApps(
			request,
			workspaceId,
		);
		const results: BulkCopyResult[] = skipped.map((skip) => ({
			appId: skip.appId,
			appName: skip.appName,
			changed: 0,
			message: skip.reason,
			part: skip.part,
			status: "skipped",
		}));

		for (const part of BulkCopyService.uniqueParts(request.parts)) {
			let sourceData: SourceData;
			try {
				sourceData = await BulkCopyService.loadSource(part, source);
			} catch (error) {
				log.error(
					{ error, part, sourceAppId: source.id },
					"Bulk copy: source load failed",
				);
				const message = describeError(error);
				for (const target of targets) {
					results.push({
						appId: target.id,
						appName: target.name,
						changed: 0,
						message,
						part,
						status: "error",
					});
				}
				continue;
			}

			for (const target of targets) {
				results.push(
					await BulkCopyService.applyOne(part, source, sourceData, target),
				);
			}
		}

		log.info(
			{
				errors: results.filter((r) => r.status === "error").length,
				ok: results.filter((r) => r.status === "ok").length,
				sourceAppId: source.id,
				targets: targets.length,
			},
			"Bulk copy applied",
		);
		return { results };
	}

	private static async applyOne(
		part: BulkCopyPart,
		source: AppRef,
		sourceData: SourceData,
		target: AppRef,
	): Promise<BulkCopyResult> {
		const base = { appId: target.id, appName: target.name, part };
		try {
			const plan = await BulkCopyService.buildPlan(
				part,
				source,
				sourceData,
				target,
			);
			const notes = plan.skipped.length ? plan.skipped.join("; ") : undefined;
			if (plan.changes.length === 0) {
				return {
					...base,
					changed: 0,
					message: notes ?? ALREADY_IDENTICAL,
					status: "skipped",
				};
			}
			await plan.write();
			return {
				...base,
				changed: plan.changes.length,
				message: notes,
				status: "ok",
			};
		} catch (error) {
			log.error(
				{ error, part, sourceAppId: source.id, targetAppId: target.id },
				"Bulk copy: part failed",
			);
			return {
				...base,
				changed: 0,
				message: describeError(error),
				status: "error",
			};
		}
	}

	private static uniqueParts(parts: BulkCopyPart[]): BulkCopyPart[] {
		return [...new Set(parts)];
	}

	/**
	 * Ownership is checked id by id so a single foreign id rejects the whole
	 * request with 404 before anything is read or written.
	 */
	private static async resolveApps(
		request: BulkCopyRequest,
		workspaceId: string,
	): Promise<{ skipped: BulkCopySkip[]; source: AppRef; targets: AppRef[] }> {
		const targetIds = [...new Set(request.targetAppIds)];
		await Promise.all(
			[request.sourceAppId, ...targetIds].map((id) =>
				verifyAppOwnership(id, workspaceId),
			),
		);

		const rows = await db
			.select({ id: apps.id, name: apps.name, platform: apps.platform })
			.from(apps)
			.where(inArray(apps.id, [request.sourceAppId, ...targetIds]));
		const byId = new Map(rows.map((row) => [row.id, row]));
		const source = byId.get(request.sourceAppId) as AppRef;

		const skipped: BulkCopySkip[] = [];
		const targets: AppRef[] = [];
		for (const id of targetIds) {
			const row = byId.get(id);
			if (!row) continue;
			if (id === source.id) {
				for (const part of BulkCopyService.uniqueParts(request.parts)) {
					skipped.push({
						appId: id,
						appName: row.name,
						part,
						reason: "Target is the source app",
					});
				}
				continue;
			}
			targets.push(row);
		}
		return { skipped, source, targets };
	}

	private static async loadSource(
		part: BulkCopyPart,
		source: AppRef,
	): Promise<SourceData> {
		switch (part) {
			case "about":
				return AsoProfileService.get(source.id);
			case "privacy":
				return PrivacyDeclarationService.get(source.id);
			case "ageRating":
				return AgeRatingService.get(source.id);
			case "keywords":
				return TrackingService.getKeywords(source.id);
			case "prompts":
				return AppAiPromptsService.getAll(source.id);
			case "listings":
				return ListingsService.getAll(source.id);
		}
	}

	private static async buildPlan(
		part: BulkCopyPart,
		source: AppRef,
		sourceData: SourceData,
		target: AppRef,
	): Promise<PartPlan> {
		switch (part) {
			case "about":
				return BulkCopyService.planAbout(
					target,
					sourceData as Awaited<ReturnType<typeof AsoProfileService.get>>,
				);
			case "privacy":
				return BulkCopyService.planPrivacy(
					target,
					sourceData as Awaited<
						ReturnType<typeof PrivacyDeclarationService.get>
					>,
				);
			case "ageRating":
				return BulkCopyService.planAgeRating(
					target,
					sourceData as Awaited<ReturnType<typeof AgeRatingService.get>>,
				);
			case "keywords":
				return BulkCopyService.planKeywords(
					target,
					sourceData as Awaited<ReturnType<typeof TrackingService.getKeywords>>,
				);
			case "prompts":
				return BulkCopyService.planPrompts(
					target,
					sourceData as Awaited<ReturnType<typeof AppAiPromptsService.getAll>>,
				);
			case "listings":
				return BulkCopyService.planListings(
					source,
					target,
					sourceData as ListingRow[],
				);
		}
	}

	private static async planAbout(
		target: AppRef,
		sourceProfile: Awaited<ReturnType<typeof AsoProfileService.get>>,
	): Promise<PartPlan> {
		if (!sourceProfile) {
			return skipPlan(target, "about", "Source app has no ASO profile");
		}
		// Same guard as PUT /aso-profile: a group-managed profile is read-only.
		const group = await AppGroupsService.getGroupForApp(target.id);
		if (group?.useSharedProfile) {
			return skipPlan(target, "about", "ASO profile is managed at group level");
		}

		const data = stripProfileMeta(sourceProfile);
		const targetProfile = await AsoProfileService.get(target.id);
		const changes: ChangeInput[] = [];
		for (const [field, after] of Object.entries(data)) {
			const before = targetProfile
				? (targetProfile as Record<string, unknown>)[field]
				: null;
			if (sameValue(before, after)) continue;
			changes.push({ after: display(after), before: display(before), field });
		}

		return planFor(target, "about", changes, [], async () => {
			await AsoProfileService.upsert(target.id, data);
		});
	}

	private static async planPrivacy(
		target: AppRef,
		sourceRow: Awaited<ReturnType<typeof PrivacyDeclarationService.get>>,
	): Promise<PartPlan> {
		if (!sourceRow) {
			return skipPlan(
				target,
				"privacy",
				"Source app has no privacy declaration",
			);
		}
		const data = {
			dataCollections: sourceRow.dataCollections,
			gpDeletionMechanism: sourceRow.gpDeletionMechanism,
			gpEncryptedInTransit: sourceRow.gpEncryptedInTransit,
			privacyPolicyUrl: sourceRow.privacyPolicyUrl,
			templateId: sourceRow.templateId,
			trackingDomains: sourceRow.trackingDomains,
			trackingEnabled: sourceRow.trackingEnabled,
		};
		const targetRow = await PrivacyDeclarationService.get(target.id);
		const changes: ChangeInput[] = [];
		for (const [field, after] of Object.entries(data)) {
			const before = targetRow
				? (targetRow as Record<string, unknown>)[field]
				: null;
			if (sameValue(before, after)) continue;
			changes.push({ after: display(after), before: display(before), field });
		}

		return planFor(target, "privacy", changes, [], async () => {
			await PrivacyDeclarationService.upsert(target.id, data);
		});
	}

	private static async planAgeRating(
		target: AppRef,
		sourceRow: Awaited<ReturnType<typeof AgeRatingService.get>>,
	): Promise<PartPlan> {
		if (!sourceRow) {
			return skipPlan(target, "ageRating", "Source app has no age rating");
		}
		const data = {
			appleQuestionnaire: sourceRow.appleQuestionnaire ?? undefined,
			googleQuestionnaire: sourceRow.googleQuestionnaire ?? undefined,
			presetId: sourceRow.presetId,
		};
		const targetRow = await AgeRatingService.get(target.id);
		const changes: ChangeInput[] = [];
		for (const [field, after] of Object.entries(data)) {
			const before = targetRow
				? (targetRow as Record<string, unknown>)[field]
				: null;
			if (sameValue(before, after)) continue;
			changes.push({ after: display(after), before: display(before), field });
		}

		return planFor(target, "ageRating", changes, [], async () => {
			await AgeRatingService.upsert(target.id, data);
		});
	}

	private static async planKeywords(
		target: AppRef,
		sourceRows: Awaited<ReturnType<typeof TrackingService.getKeywords>>,
	): Promise<PartPlan> {
		if (sourceRows.length === 0) {
			return skipPlan(target, "keywords", "Source app has no tracked keywords");
		}
		const targetRows = await TrackingService.getKeywords(target.id);
		const existing = new Map<string, Set<string>>();
		for (const row of targetRows) {
			const set = existing.get(row.country) ?? new Set<string>();
			set.add(row.keyword);
			existing.set(row.country, set);
		}
		const wanted = new Map<string, string[]>();
		for (const row of sourceRows) {
			const list = wanted.get(row.country) ?? [];
			if (!list.includes(row.keyword)) list.push(row.keyword);
			wanted.set(row.country, list);
		}

		const changes: ChangeInput[] = [];
		const skipped: string[] = [];
		const toAdd = new Map<string, string[]>();
		for (const [country, keywords] of wanted) {
			const present = existing.get(country) ?? new Set<string>();
			const missing = keywords.filter((k) => !present.has(k));
			// addKeywords rejects a whole batch over the cap, so trim up front and
			// tell the user what did not fit instead of failing the country.
			const room = Math.max(0, MAX_KEYWORDS_PER_COUNTRY - present.size);
			const fits = missing.slice(0, room);
			if (missing.length > fits.length) {
				skipped.push(
					`${country}: ${missing.length - fits.length} keyword(s) not copied (cap ${MAX_KEYWORDS_PER_COUNTRY} per country)`,
				);
			}
			if (fits.length === 0) continue;
			toAdd.set(country, fits);
			for (const keyword of fits) {
				changes.push({
					after: keyword,
					before: null,
					field: "keyword",
					language: country,
				});
			}
		}

		return planFor(target, "keywords", changes, skipped, async () => {
			for (const [country, keywords] of toAdd) {
				await TrackingService.addKeywords(target.id, country, keywords);
			}
		});
	}

	private static async planPrompts(
		target: AppRef,
		sourceRows: Awaited<ReturnType<typeof AppAiPromptsService.getAll>>,
	): Promise<PartPlan> {
		if (sourceRows.length === 0) {
			return skipPlan(target, "prompts", "Source app has no custom AI prompts");
		}
		const targetRows = await AppAiPromptsService.getAll(target.id);
		const existing = new Map(
			targetRows.map((row) => [`${row.field}:${row.mode}`, row.prompt]),
		);
		const pending: Array<{ field: string; mode: string; prompt: string }> = [];
		const changes: ChangeInput[] = [];
		for (const row of sourceRows) {
			const key = `${row.field}:${row.mode}`;
			const before = existing.get(key) ?? null;
			if (before === row.prompt) continue;
			pending.push({ field: row.field, mode: row.mode, prompt: row.prompt });
			changes.push({ after: row.prompt, before, field: key });
		}

		return planFor(target, "prompts", changes, [], async () => {
			for (const item of pending) {
				await AppAiPromptsService.upsert(
					target.id,
					item.field,
					item.mode,
					item.prompt,
				);
			}
		});
	}

	private static async planListings(
		source: AppRef,
		target: AppRef,
		sourceRows: ListingRow[],
	): Promise<PartPlan> {
		if (source.platform !== target.platform) {
			return skipPlan(
				target,
				"listings",
				`Listings can only be copied between apps on the same platform (source is ${source.platform}, target is ${target.platform})`,
			);
		}
		const sourceByLanguage = effectiveListings(sourceRows);
		if (sourceByLanguage.size === 0) {
			return skipPlan(target, "listings", "Source app has no listings");
		}
		const targetRows = await db
			.select()
			.from(listings)
			.where(eq(listings.appId, target.id));
		const targetByLanguage = effectiveListings(targetRows);

		const changes: ChangeInput[] = [];
		const pending = new Map<string, Record<string, string>>();
		for (const [language, sourceRow] of sourceByLanguage) {
			const targetRow = targetByLanguage.get(language);
			const patch: Record<string, string> = {};
			for (const field of LISTING_COPY_FIELDS) {
				const after = sourceRow[field];
				// A null source field carries nothing to copy; clearing the target
				// would silently destroy text the user wrote there.
				if (after === null) continue;
				const before = targetRow?.[field] ?? null;
				if (before === after) continue;
				patch[field] = after;
				changes.push({ after, before, field, language });
			}
			if (Object.keys(patch).length > 0) pending.set(language, patch);
		}

		return planFor(target, "listings", changes, [], async () => {
			for (const [language, patch] of pending) {
				await ListingsService.updateDraft(target.id, language, patch);
			}
		});
	}
}
