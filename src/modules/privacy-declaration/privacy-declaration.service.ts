import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { appPrivacyDeclarations } from "@/utils/db/schema";
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
}
