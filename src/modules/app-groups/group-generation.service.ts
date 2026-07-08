import type { ListingField } from "@/modules/ai/ai.prompts";
import { AIService } from "@/modules/ai/ai.service";
import { ListingsService } from "@/modules/listings/listings.service";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { AppGroupsService } from "./app-groups.service";

const log = createLogger("group-generation");

/**
 * Typed errors from buildError() are plain objects with a `response`
 * payload, not Error instances — unwrap their human-readable `info` so the
 * per-field error report stays meaningful (no "[object Object]").
 */
function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object") {
		const response = (
			err as { response?: { code?: string; data?: { info?: string } } }
		).response;
		if (response?.data?.info) return response.data.info;
		if (response?.code) return response.code;
	}
	return String(err);
}

/** AI listing field → draft listing column. */
const FIELD_TO_DRAFT_COLUMN: Record<string, string> = {
	description: "fullDesc",
	fullDescription: "fullDesc",
	keywords: "keywords",
	promotionalText: "promoText",
	shortDescription: "shortDesc",
	subtitle: "shortDesc",
	title: "title",
	whatsNew: "whatsNew",
};

const DEFAULT_FIELDS: ListingField[] = [
	"title",
	"subtitle",
	"description",
	"keywords",
	"promotionalText",
	"whatsNew",
];

/**
 * Map the requested generic field list onto the platform-specific one:
 * subtitle ↔ shortDescription are the same slot (iOS vs Android), while
 * keywords / promotionalText exist only on iOS and are skipped on Android.
 */
function fieldsForPlatform(
	requested: ListingField[],
	platform: string,
): ListingField[] {
	const isIos = platform === "ios";
	const resolved: ListingField[] = [];
	for (const field of requested) {
		if (field === "subtitle" || field === "shortDescription") {
			resolved.push(isIos ? "subtitle" : "shortDescription");
			continue;
		}
		if ((field === "keywords" || field === "promotionalText") && !isIos) {
			continue;
		}
		if (field === "fullDescription") {
			resolved.push("description");
			continue;
		}
		resolved.push(field);
	}
	return [...new Set(resolved)];
}

export interface GroupGenerationOptions {
	fields?: ListingField[];
	sourceLanguage?: string;
	translateToOthers?: boolean;
}

export interface GroupMemberGenerationResult {
	appId: string;
	appName: string;
	errors: { field: string; message: string }[];
	generated: Record<string, string>;
	platform: string;
	translation?: { error?: string; translated?: number };
}

export class GroupGenerationService {
	/**
	 * Generate listing drafts for EVERY member of an app group (typically the
	 * Android + iOS pair of the same product) in one pass. The group's shared
	 * ASO profile is used automatically by the AI layer when enabled. Results
	 * are written to each app's draft listing; nothing is published.
	 *
	 * Individual field failures don't abort the run — they are reported per
	 * app so a partial success is still useful.
	 */
	static async generateListings(
		workspaceId: string,
		groupId: string,
		options: GroupGenerationOptions = {},
	) {
		const group = await AppGroupsService.getById(groupId, workspaceId);
		if (!group.members.length) {
			buildError("badRequest", { info: "App group has no member apps" });
		}

		const sourceLanguage = options.sourceLanguage ?? "en-US";
		const requestedFields = options.fields?.length
			? options.fields
			: DEFAULT_FIELDS;

		const results: GroupMemberGenerationResult[] = [];

		for (const member of group.members) {
			const app = member.app;
			const memberResult: GroupMemberGenerationResult = {
				appId: app.id,
				appName: app.name,
				errors: [],
				generated: {},
				platform: app.platform,
			};

			const fields = fieldsForPlatform(requestedFields, app.platform);
			const draftData: Record<string, string> = {};

			for (const field of fields) {
				try {
					const { result } = await AIService.generateListingField(
						workspaceId,
						field,
						app.id,
						app.name,
						app.platform,
						sourceLanguage,
					);
					memberResult.generated[field] = result;
					const column = FIELD_TO_DRAFT_COLUMN[field];
					if (column) draftData[column] = result;
				} catch (err) {
					memberResult.errors.push({ field, message: errorMessage(err) });
				}
			}

			if (Object.keys(draftData).length > 0) {
				await ListingsService.updateDraft(app.id, sourceLanguage, draftData);
			}

			if (options.translateToOthers && Object.keys(draftData).length > 0) {
				try {
					const { translated } = await ListingsService.translateFromLanguage(
						workspaceId,
						app.id,
						sourceLanguage,
					);
					memberResult.translation = { translated };
				} catch (err) {
					memberResult.translation = { error: errorMessage(err) };
				}
			}

			log.info(
				{
					appId: app.id,
					errors: memberResult.errors.length,
					fields: Object.keys(memberResult.generated).length,
					groupId,
				},
				"Generated listing drafts for group member",
			);

			results.push(memberResult);
		}

		return { results, sourceLanguage };
	}
}
