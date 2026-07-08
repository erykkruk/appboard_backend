import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { groupAsoProfiles } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("group-aso-profile-service");

type GroupAsoProfileData = Omit<
	typeof groupAsoProfiles.$inferInsert,
	"id" | "groupId" | "createdAt" | "updatedAt"
>;

export class GroupAsoProfileService {
	static async get(groupId: string) {
		const [profile] = await db
			.select()
			.from(groupAsoProfiles)
			.where(eq(groupAsoProfiles.groupId, groupId))
			.limit(1);

		return profile ?? null;
	}

	static async upsert(groupId: string, data: GroupAsoProfileData) {
		const setData =
			Object.keys(data).length > 0 ? data : { updatedAt: new Date() };

		const [result] = await db
			.insert(groupAsoProfiles)
			.values({ ...data, groupId })
			.onConflictDoUpdate({
				set: setData,
				target: [groupAsoProfiles.groupId],
			})
			.returning();

		log.info({ groupId }, "Group ASO profile upserted");
		return result;
	}
}
