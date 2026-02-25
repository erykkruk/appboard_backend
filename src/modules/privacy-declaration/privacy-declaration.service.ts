import { eq } from "drizzle-orm";
import type { StoreType } from "@/config/const";
import { createProvider } from "@/providers";
import { decrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { appPrivacyDeclarations, apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { getPrivacyTemplate } from "./privacy-declaration.templates";

const log = createLogger("privacy-declaration-service");

interface UpsertData {
	dataCollections?: Array<{
		category: string;
		dataType: string;
		linked: boolean;
		purposes: string[];
		tracking: boolean;
	}> | null;
	privacyPolicyUrl?: string | null;
	templateId: string;
	trackingDomains?: string[] | null;
	trackingEnabled?: boolean;
}

export class PrivacyDeclarationService {
	static async get(appId: string) {
		const [declaration] = await db
			.select()
			.from(appPrivacyDeclarations)
			.where(eq(appPrivacyDeclarations.appId, appId))
			.limit(1);

		return declaration ?? null;
	}

	static async upsert(appId: string, data: UpsertData) {
		let dataCollections = data.dataCollections ?? [];

		if (data.templateId !== "custom") {
			const template = getPrivacyTemplate(data.templateId);
			if (template) {
				dataCollections = template.dataCollections;
			}
		}

		const trackingEnabled =
			data.trackingEnabled ?? dataCollections.some((dc) => dc.tracking);

		const values = {
			appId,
			dataCollections,
			privacyPolicyUrl: data.privacyPolicyUrl ?? null,
			templateId: data.templateId,
			trackingDomains: data.trackingDomains ?? null,
			trackingEnabled,
		};

		const [result] = await db
			.insert(appPrivacyDeclarations)
			.values(values)
			.onConflictDoUpdate({
				set: {
					dataCollections: values.dataCollections,
					privacyPolicyUrl: values.privacyPolicyUrl,
					templateId: values.templateId,
					trackingDomains: values.trackingDomains,
					trackingEnabled: values.trackingEnabled,
					updatedAt: new Date(),
				},
				target: [appPrivacyDeclarations.appId],
			})
			.returning();

		log.info({ appId }, "Privacy declaration upserted");
		return result;
	}

	static async publish(appId: string) {
		const declaration = await PrivacyDeclarationService.get(appId);
		if (!declaration) {
			buildError("notFound", {
				info: "Privacy declaration not found — save first",
			});
			throw new Error("unreachable");
		}

		const result = await db
			.select({ app: apps, store: stores })
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(eq(apps.id, appId))
			.limit(1);

		if (result.length === 0) {
			buildError("notFound", { info: "App not found" });
			throw new Error("unreachable");
		}

		const { app, store } = result[0];

		if (!store.credentials) {
			buildError("badRequest", { info: "No store credentials configured" });
			throw new Error("unreachable");
		}

		const credentials = JSON.parse(decrypt(store.credentials));
		const provider = createProvider(store.type as StoreType, credentials);

		await provider.updatePrivacyDeclaration(app.externalId, {
			dataCollections: declaration.dataCollections as Array<{
				category: string;
				dataType: string;
				linked: boolean;
				purposes: string[];
				tracking: boolean;
			}>,
			privacyPolicyUrl: declaration.privacyPolicyUrl,
			trackingDomains: declaration.trackingDomains,
			trackingEnabled: declaration.trackingEnabled,
		});

		log.info({ appId }, "Privacy declaration published to store");
		return { success: true };
	}
}
