import { and, eq } from "drizzle-orm";
import { APP_STORE_CATEGORIES, type StoreType } from "@/config/const";
import { AIService } from "@/modules/ai/ai.service";
import { createProvider } from "@/providers";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { apps, listingHistory, listings, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("listings-service");

const LISTING_FIELDS = [
	"fullDesc",
	"keywords",
	"marketingUrl",
	"privacyUrl",
	"promoText",
	"shortDesc",
	"supportUrl",
	"title",
	"videoUrl",
	"whatsNew",
] as const;

// Mapping: DB column → AI field name (for translateLocalization)
const DB_TO_AI_FIELD: Record<string, string> = {
	fullDesc: "description",
	keywords: "keywords",
	promoText: "promotionalText",
	shortDesc: "shortDescription",
	title: "title",
	whatsNew: "whatsNew",
};

// Reverse mapping: AI field name → DB column
const AI_TO_DB_FIELD: Record<string, string> = {
	description: "fullDesc",
	keywords: "keywords",
	promotionalText: "promoText",
	shortDescription: "shortDesc",
	title: "title",
	whatsNew: "whatsNew",
};

// Translatable fields (excludes URL fields which shouldn't be translated)
const TRANSLATABLE_FIELDS = [
	"fullDesc",
	"keywords",
	"promoText",
	"shortDesc",
	"title",
	"whatsNew",
] as const;

const EXPORT_COLUMNS = [
	"language",
	"title",
	"shortDesc",
	"fullDesc",
	"keywords",
	"promoText",
	"whatsNew",
	"marketingUrl",
	"supportUrl",
	"privacyUrl",
	"videoUrl",
] as const;

type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;

function escapeCsvField(value: string): string {
	if (
		value.includes(",") ||
		value.includes('"') ||
		value.includes("\n") ||
		value.includes("\r")
	) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function rowToCsv(row: ExportRow): string {
	return EXPORT_COLUMNS.map((col) => escapeCsvField(row[col] ?? "")).join(",");
}

function toCsv(rows: ExportRow[]): string {
	const header = EXPORT_COLUMNS.join(",");
	const lines = rows.map(rowToCsv);
	return [header, ...lines].join("\n");
}

function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ",") {
			fields.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	fields.push(current);
	return fields;
}

function parseCsv(content: string): {
	rows: Record<string, string>[];
	errors: string[];
} {
	const errors: string[] = [];
	const lines: string[] = [];

	// Handle multiline quoted fields by joining lines within quotes
	let buffer = "";
	let inQuotes = false;
	for (const rawLine of content.split(/\r?\n/)) {
		if (!inQuotes) {
			buffer = rawLine;
		} else {
			buffer += `\n${rawLine}`;
		}
		const quoteCount = (buffer.match(/"/g) || []).length;
		inQuotes = quoteCount % 2 !== 0;
		if (!inQuotes) {
			lines.push(buffer);
			buffer = "";
		}
	}
	if (buffer) lines.push(buffer);

	if (lines.length < 2) {
		return {
			errors: ["CSV file must have a header row and at least one data row"],
			rows: [],
		};
	}

	const headers = parseCsvLine(lines[0]).map((h) => h.trim());
	const rows: Record<string, string>[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const values = parseCsvLine(line);
		const row: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) {
			const val = values[j]?.trim() ?? "";
			if (val) row[headers[j]] = val;
		}

		if (!row.language) {
			errors.push(`Row ${i + 1}: missing required field "language"`);
			continue;
		}

		rows.push(row);
	}

	return { errors, rows };
}

function parseJsonContent(content: string): {
	rows: Record<string, string>[];
	errors: string[];
} {
	const errors: string[] = [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return { errors: ["Invalid JSON format"], rows: [] };
	}

	if (!Array.isArray(parsed)) {
		return { errors: ["JSON must be an array of objects"], rows: [] };
	}

	const rows: Record<string, string>[] = [];
	for (let i = 0; i < parsed.length; i++) {
		const item = parsed[i];
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			errors.push(`Item ${i + 1}: must be an object`);
			continue;
		}

		const row: Record<string, string> = {};
		for (const [key, value] of Object.entries(item)) {
			if (typeof value === "string" && value) {
				row[key] = value;
			}
		}

		if (!row.language) {
			errors.push(`Item ${i + 1}: missing required field "language"`);
			continue;
		}

		rows.push(row);
	}

	return { errors, rows };
}

export class ListingsService {
	static async syncFromStore(appId: string) {
		const app = await ListingsService.getAppWithStore(appId);
		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		const fetched = await provider.fetchListings(app.externalId);

		for (const listing of fetched) {
			await db
				.insert(listings)
				.values({
					appId,
					fullDesc: listing.fullDesc,
					keywords: listing.keywords,
					language: listing.language,
					marketingUrl: listing.marketingUrl,
					privacyUrl: listing.privacyUrl,
					promoText: listing.promoText,
					shortDesc: listing.shortDesc,
					source: "remote",
					supportUrl: listing.supportUrl,
					syncedAt: new Date(),
					title: listing.title,
					videoUrl: listing.videoUrl,
					whatsNew: listing.whatsNew,
				})
				.onConflictDoUpdate({
					set: {
						fullDesc: listing.fullDesc,
						keywords: listing.keywords,
						marketingUrl: listing.marketingUrl,
						privacyUrl: listing.privacyUrl,
						promoText: listing.promoText,
						shortDesc: listing.shortDesc,
						supportUrl: listing.supportUrl,
						syncedAt: new Date(),
						title: listing.title,
						videoUrl: listing.videoUrl,
						whatsNew: listing.whatsNew,
					},
					target: [listings.appId, listings.language, listings.source],
				});
		}

		// Sync categories from store
		try {
			const categories = await provider.fetchCategories(app.externalId);
			await db
				.update(apps)
				.set({
					primaryCategory: categories.primaryCategory,
					secondaryCategory: categories.secondaryCategory,
				})
				.where(eq(apps.id, appId));
			log.info({ appId, categories }, "Categories synced from store");
		} catch (err) {
			log.warn({ appId, err }, "Failed to sync categories from store");
		}

		await db
			.update(apps)
			.set({ lastSyncedAt: new Date() })
			.where(eq(apps.id, appId));

		log.info({ appId, count: fetched.length }, "Listings synced from store");
		return { synced: fetched.length };
	}

	static async getAll(appId: string) {
		return db.select().from(listings).where(eq(listings.appId, appId));
	}

	static async getByLanguage(appId: string, language: string) {
		const result = await db
			.select()
			.from(listings)
			.where(and(eq(listings.appId, appId), eq(listings.language, language)));

		if (result.length === 0) {
			buildError("notFound", { info: "Listing not found" });
		}

		const remote = result.find((l) => l.source === "remote");
		const draft = result.find((l) => l.source === "draft");

		return { draft: draft ?? null, remote: remote ?? null };
	}

	static async updateDraft(
		appId: string,
		language: string,
		data: Record<string, string | undefined>,
	) {
		const existing = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.language, language),
					eq(listings.source, "draft"),
				),
			)
			.limit(1);

		if (existing.length > 0) {
			await db
				.update(listings)
				.set({ ...data, isDirty: true })
				.where(eq(listings.id, existing[0].id));
			return db
				.select()
				.from(listings)
				.where(eq(listings.id, existing[0].id))
				.then((r) => r[0]);
		}

		// Create draft from remote if it exists
		const remote = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.language, language),
					eq(listings.source, "remote"),
				),
			)
			.limit(1);

		const baseData =
			remote.length > 0
				? {
						fullDesc: remote[0].fullDesc,
						keywords: remote[0].keywords,
						marketingUrl: remote[0].marketingUrl,
						privacyUrl: remote[0].privacyUrl,
						promoText: remote[0].promoText,
						shortDesc: remote[0].shortDesc,
						supportUrl: remote[0].supportUrl,
						title: remote[0].title,
						videoUrl: remote[0].videoUrl,
						whatsNew: remote[0].whatsNew,
					}
				: {};

		const [draft] = await db
			.insert(listings)
			.values({
				...baseData,
				...data,
				appId,
				isDirty: true,
				language,
				source: "draft",
			})
			.returning();

		return draft;
	}

	static async getDraftDiffs(appId: string) {
		const all = await db
			.select()
			.from(listings)
			.where(eq(listings.appId, appId));

		// Group by language
		const byLang = new Map<
			string,
			{ draft?: (typeof all)[0]; remote?: (typeof all)[0] }
		>();
		for (const row of all) {
			const entry = byLang.get(row.language) ?? {};
			if (row.source === "draft") entry.draft = row;
			else if (row.source === "remote") entry.remote = row;
			byLang.set(row.language, entry);
		}

		const diffs: Array<{
			language: string;
			fields: Array<{
				field: string;
				oldValue: string | null;
				newValue: string | null;
			}>;
		}> = [];

		for (const [language, { draft, remote }] of byLang) {
			if (!draft) continue;

			const fields: Array<{
				field: string;
				oldValue: string | null;
				newValue: string | null;
			}> = [];

			for (const field of LISTING_FIELDS) {
				const draftVal = (draft[field] ?? null) as string | null;
				const remoteVal = (remote?.[field] ?? null) as string | null;
				if (draftVal !== remoteVal) {
					fields.push({ field, newValue: draftVal, oldValue: remoteVal });
				}
			}

			if (fields.length > 0) {
				diffs.push({ fields, language });
			}
		}

		// Stable ordering: sort by language for deterministic output
		diffs.sort((a, b) => a.language.localeCompare(b.language));
		return diffs;
	}

	static async publish(appId: string) {
		const app = await ListingsService.getAppWithStore(appId);
		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		const dirtyDrafts = await db
			.select()
			.from(listings)
			.where(
				and(
					eq(listings.appId, appId),
					eq(listings.isDirty, true),
					eq(listings.source, "draft"),
				),
			);

		if (dirtyDrafts.length === 0) {
			return { published: 0 };
		}

		// Collect changes per language for batch processing
		const batchUpdates: Array<{
			draft: (typeof dirtyDrafts)[0];
			changedFields: Record<string, string | undefined>;
			remote: (typeof dirtyDrafts)[0] | undefined;
		}> = [];

		for (const draft of dirtyDrafts) {
			const [remote] = await db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.appId, appId),
						eq(listings.language, draft.language),
						eq(listings.source, "remote"),
					),
				)
				.limit(1);

			const changedFields: Record<string, string | undefined> = {};
			if (remote) {
				// Existing remote: send only changed fields
				for (const field of LISTING_FIELDS) {
					const draftVal = draft[field] ?? null;
					const remoteVal = remote[field] ?? null;
					if (draftVal !== remoteVal && draftVal !== null) {
						changedFields[field] = draftVal;
					}
				}
			} else {
				// No remote listing yet: send ALL non-null fields from draft
				// so the store gets the complete listing (GP requires title etc.)
				for (const field of LISTING_FIELDS) {
					const draftVal = draft[field] ?? null;
					if (draftVal !== null) {
						changedFields[field] = draftVal;
					}
				}
			}

			batchUpdates.push({ changedFields, draft, remote });
		}

		// GP: use single edit+commit for all languages
		const hasChanges = batchUpdates.some(
			(u) => Object.keys(u.changedFields).length > 0,
		);

		if (hasChanges && provider.batchPublishListings) {
			const updates = batchUpdates
				.filter((u) => Object.keys(u.changedFields).length > 0)
				.map((u) => ({
					data: u.changedFields,
					language: u.draft.language,
				}));
			try {
				await provider.batchPublishListings(app.externalId, updates);
				// Successful publish — ensure app is not marked as draft
				if (app.status === "draft") {
					await db
						.update(apps)
						.set({ status: "active" })
						.where(eq(apps.id, appId));
				}
			} catch (err) {
				await ListingsService.detectDraftApp(err, appId);
				throw err;
			}
		} else if (hasChanges) {
			// App Store / fallback: update per-language then publish
			for (const { changedFields, draft } of batchUpdates) {
				if (Object.keys(changedFields).length > 0) {
					await provider.updateListing(
						app.externalId,
						draft.language,
						changedFields,
					);
				}
			}
			await provider.publishListings(app.externalId);
		}

		// Record history + update remote + mark clean
		for (const { draft, remote } of batchUpdates) {
			for (const field of LISTING_FIELDS) {
				const oldVal = remote?.[field] ?? null;
				const newVal = draft[field] ?? null;
				if (oldVal !== newVal) {
					await db.insert(listingHistory).values({
						appId,
						field,
						language: draft.language,
						listingId: draft.id,
						newValue: newVal,
						oldValue: oldVal,
						publishedAt: new Date(),
					});
				}
			}

			if (remote) {
				await db
					.update(listings)
					.set({
						fullDesc: draft.fullDesc,
						keywords: draft.keywords,
						marketingUrl: draft.marketingUrl,
						privacyUrl: draft.privacyUrl,
						promoText: draft.promoText,
						shortDesc: draft.shortDesc,
						supportUrl: draft.supportUrl,
						syncedAt: new Date(),
						title: draft.title,
						videoUrl: draft.videoUrl,
						whatsNew: draft.whatsNew,
					})
					.where(eq(listings.id, remote.id));
			}

			await db
				.update(listings)
				.set({ isDirty: false })
				.where(eq(listings.id, draft.id));
		}

		log.info({ appId, count: dirtyDrafts.length }, "Listings published");
		return { published: dirtyDrafts.length };
	}

	static generateTemplate(format: "csv" | "json"): string {
		if (format === "json") {
			const template: Record<string, string> = {};
			for (const col of EXPORT_COLUMNS) {
				template[col] = "";
			}
			return JSON.stringify([template], null, 2);
		}

		const emptyRow = {} as ExportRow;
		for (const col of EXPORT_COLUMNS) {
			emptyRow[col] = col === "language" ? "en-US" : "";
		}
		return toCsv([emptyRow]);
	}

	static async exportListings(
		appId: string,
		format: "csv" | "json",
	): Promise<string> {
		const allListings = await db
			.select()
			.from(listings)
			.where(eq(listings.appId, appId));

		// Group by language, prefer draft over remote
		const byLanguage = new Map<string, (typeof allListings)[number]>();
		for (const listing of allListings) {
			const existing = byLanguage.get(listing.language);
			if (
				!existing ||
				(listing.source === "draft" && existing.source === "remote")
			) {
				byLanguage.set(listing.language, listing);
			}
		}

		const rows: ExportRow[] = [];
		for (const listing of byLanguage.values()) {
			const row = {} as ExportRow;
			for (const col of EXPORT_COLUMNS) {
				row[col] = (listing[col as keyof typeof listing] as string) ?? "";
			}
			rows.push(row);
		}

		if (format === "json") {
			return JSON.stringify(rows, null, 2);
		}
		return toCsv(rows);
	}

	static async importListings(
		appId: string,
		file: File,
	): Promise<{ imported: number; errors: string[] }> {
		const content = await file.text();
		const isJson =
			file.type === "application/json" || file.name?.endsWith(".json");

		const { rows, errors } = isJson
			? parseJsonContent(content)
			: parseCsv(content);

		let imported = 0;
		for (const row of rows) {
			const data: Record<string, string | undefined> = {};
			for (const field of LISTING_FIELDS) {
				if (field in row && row[field]) {
					data[field] = row[field];
				}
			}

			await db
				.insert(listings)
				.values({
					...data,
					appId,
					isDirty: true,
					language: row.language,
					source: "draft",
				})
				.onConflictDoUpdate({
					set: { ...data, isDirty: true },
					target: [listings.appId, listings.language, listings.source],
				});

			imported++;
		}

		log.info(
			{ appId, errorCount: errors.length, imported },
			"Listings imported",
		);
		return { errors, imported };
	}

	static async getCategories(appId: string) {
		const [app] = await db
			.select({
				platform: apps.platform,
				primaryCategory: apps.primaryCategory,
				secondaryCategory: apps.secondaryCategory,
			})
			.from(apps)
			.where(eq(apps.id, appId))
			.limit(1);

		if (!app) buildError("notFound", { info: "App not found" });

		return {
			availableCategories: APP_STORE_CATEGORIES,
			primaryCategory: app.primaryCategory,
			secondaryCategory: app.secondaryCategory,
		};
	}

	static async updateCategories(
		appId: string,
		primaryCategory: string,
		secondaryCategory?: string,
	) {
		// Auto-save to local DB only
		await db
			.update(apps)
			.set({
				primaryCategory,
				secondaryCategory: secondaryCategory ?? null,
			})
			.where(eq(apps.id, appId));

		log.info(
			{ appId, primaryCategory, secondaryCategory },
			"Categories saved locally",
		);

		return { primaryCategory, secondaryCategory: secondaryCategory ?? null };
	}

	static async publishCategories(appId: string) {
		const app = await ListingsService.getAppWithStore(appId);

		if (!app.primaryCategory) {
			log.info({ appId }, "No primary category set — skipping publish");
			return { skipped: true, success: true };
		}

		const credentials = JSON.parse(decrypt(app.store.credentials!));
		const provider = createProvider(app.store.type as StoreType, credentials);

		await provider.updateCategories(
			app.externalId,
			app.primaryCategory,
			app.secondaryCategory ?? undefined,
		);

		log.info({ appId }, "Categories published to store");
		return { success: true };
	}

	static async translateFromLanguage(
		workspaceId: string,
		appId: string,
		sourceLanguage: string,
	): Promise<{
		translated: number;
		results: Record<string, { model: string; fields: string[] }>;
	}> {
		const app = await ListingsService.getAppWithStore(appId);

		// Get source listing (prefer draft, fallback to remote)
		const sourceListing = await ListingsService.getSourceListing(
			appId,
			sourceLanguage,
		);

		// Build AI fields from source listing
		const aiFields = ListingsService.buildAiFields(sourceListing);
		if (Object.keys(aiFields).length === 0) {
			return { results: {}, translated: 0 };
		}

		// Get all distinct languages for this app (excluding source)
		const targetLanguages = await ListingsService.getOtherLanguages(
			appId,
			sourceLanguage,
		);
		if (targetLanguages.length === 0) {
			return { results: {}, translated: 0 };
		}

		const results: Record<string, { model: string; fields: string[] }> = {};

		for (const targetLang of targetLanguages) {
			const { model, translations } = await AIService.translateLocalization(
				workspaceId,
				appId,
				app.name,
				app.platform,
				aiFields,
				sourceLanguage,
				targetLang,
			);

			// Convert AI field names back to DB columns and save
			const dbData: Record<string, string> = {};
			for (const [aiField, value] of Object.entries(translations)) {
				const dbField = AI_TO_DB_FIELD[aiField];
				if (dbField && value) {
					dbData[dbField] = value;
				}
			}

			if (Object.keys(dbData).length > 0) {
				await ListingsService.updateDraft(appId, targetLang, dbData);
				results[targetLang] = {
					fields: Object.keys(translations),
					model,
				};
			}
		}

		log.info(
			{ appId, sourceLanguage, targetCount: targetLanguages.length },
			"Translated all languages from source",
		);

		return { results, translated: Object.keys(results).length };
	}

	static async translateFieldFromLanguage(
		workspaceId: string,
		appId: string,
		sourceLanguage: string,
		field: string,
	): Promise<{
		translated: number;
		results: Record<string, { model: string; value: string }>;
	}> {
		const app = await ListingsService.getAppWithStore(appId);

		// Get source listing
		const sourceListing = await ListingsService.getSourceListing(
			appId,
			sourceLanguage,
		);

		// Validate the field exists and has a value
		const dbField = AI_TO_DB_FIELD[field] ?? field;
		const aiField = DB_TO_AI_FIELD[dbField] ?? field;

		const sourceValue = sourceListing[dbField as keyof typeof sourceListing] as
			| string
			| null;
		if (!sourceValue) {
			buildError("badRequest", {
				info: `Field "${field}" is empty in source language "${sourceLanguage}"`,
			});
		}

		const aiFields: Record<string, string> = { [aiField]: sourceValue! };

		// Get all distinct languages for this app (excluding source)
		const targetLanguages = await ListingsService.getOtherLanguages(
			appId,
			sourceLanguage,
		);
		if (targetLanguages.length === 0) {
			return { results: {}, translated: 0 };
		}

		const results: Record<string, { model: string; value: string }> = {};

		for (const targetLang of targetLanguages) {
			const { model, translations } = await AIService.translateLocalization(
				workspaceId,
				appId,
				app.name,
				app.platform,
				aiFields,
				sourceLanguage,
				targetLang,
			);

			const translatedValue = translations[aiField];
			if (translatedValue) {
				const saveField = AI_TO_DB_FIELD[aiField] ?? aiField;
				await ListingsService.updateDraft(appId, targetLang, {
					[saveField]: translatedValue,
				});
				results[targetLang] = { model, value: translatedValue };
			}
		}

		log.info(
			{
				appId,
				field: aiField,
				sourceLanguage,
				targetCount: targetLanguages.length,
			},
			"Translated field to all languages",
		);

		return { results, translated: Object.keys(results).length };
	}

	private static async getSourceListing(appId: string, language: string) {
		const result = await db
			.select()
			.from(listings)
			.where(and(eq(listings.appId, appId), eq(listings.language, language)));

		const draft = result.find((l) => l.source === "draft");
		const remote = result.find((l) => l.source === "remote");
		const sourceListing = draft ?? remote;

		if (!sourceListing) {
			buildError("notFound", {
				info: `No listing found for language "${language}"`,
			});
		}

		return sourceListing;
	}

	private static buildAiFields(
		listing: Record<string, unknown>,
	): Record<string, string> {
		const aiFields: Record<string, string> = {};
		for (const dbField of TRANSLATABLE_FIELDS) {
			const value = listing[dbField] as string | null;
			if (value?.trim()) {
				const aiField = DB_TO_AI_FIELD[dbField];
				if (aiField) {
					aiFields[aiField] = value;
				}
			}
		}
		return aiFields;
	}

	private static async getOtherLanguages(
		appId: string,
		excludeLanguage: string,
	): Promise<string[]> {
		const allListings = await db
			.select({ language: listings.language })
			.from(listings)
			.where(eq(listings.appId, appId));

		const languages = new Set(allListings.map((l) => l.language));
		languages.delete(excludeLanguage);
		return [...languages];
	}

	private static async getAppWithStore(appId: string) {
		const result = await db
			.select({ app: apps, store: stores })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);

		if (result.length === 0) buildError("notFound", { info: "App not found" });

		return { ...result[0].app, store: result[0].store };
	}

	/**
	 * Detects "draft app" error from GP API and marks the app accordingly.
	 */
	private static async detectDraftApp(err: unknown, appId: string) {
		const msg =
			(err as { message?: string })?.message ??
			JSON.stringify((err as { response?: unknown })?.response ?? "");
		if (/draft\s+app/i.test(msg)) {
			log.warn({ appId }, "GP draft app detected — marking status");
			await db.update(apps).set({ status: "draft" }).where(eq(apps.id, appId));
		}
	}
}
