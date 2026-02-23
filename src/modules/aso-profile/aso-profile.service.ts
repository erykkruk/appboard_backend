import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { appAsoProfiles } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("aso-profile-service");

type AsoProfileData = Omit<
	typeof appAsoProfiles.$inferInsert,
	"id" | "appId" | "createdAt" | "updatedAt"
>;

export class AsoProfileService {
	static async get(appId: string) {
		const [profile] = await db
			.select()
			.from(appAsoProfiles)
			.where(eq(appAsoProfiles.appId, appId))
			.limit(1);

		return profile ?? null;
	}

	static async upsert(appId: string, data: AsoProfileData) {
		const setData =
			Object.keys(data).length > 0 ? data : { updatedAt: new Date() };

		const [result] = await db
			.insert(appAsoProfiles)
			.values({ ...data, appId })
			.onConflictDoUpdate({
				set: setData,
				target: [appAsoProfiles.appId],
			})
			.returning();

		log.info({ appId }, "ASO profile upserted");
		return result;
	}
}
