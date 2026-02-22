import { and, eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { appAiPrompts } from "@/utils/db/schema";

export class AppAiPromptsService {
	static async getAll(appId: string) {
		return db.select().from(appAiPrompts).where(eq(appAiPrompts.appId, appId));
	}

	static async get(appId: string, field: string, mode: string) {
		const [row] = await db
			.select()
			.from(appAiPrompts)
			.where(
				and(
					eq(appAiPrompts.appId, appId),
					eq(appAiPrompts.field, field),
					eq(appAiPrompts.mode, mode),
				),
			)
			.limit(1);
		return row ?? null;
	}

	static async upsert(
		appId: string,
		field: string,
		mode: string,
		prompt: string,
	) {
		const existing = await AppAiPromptsService.get(appId, field, mode);

		if (existing) {
			await db
				.update(appAiPrompts)
				.set({ prompt })
				.where(eq(appAiPrompts.id, existing.id));
			return { ...existing, prompt };
		}

		const [row] = await db
			.insert(appAiPrompts)
			.values({ appId, field, mode, prompt })
			.returning();
		return row;
	}

	static async delete(appId: string, field: string, mode: string) {
		await db
			.delete(appAiPrompts)
			.where(
				and(
					eq(appAiPrompts.appId, appId),
					eq(appAiPrompts.field, field),
					eq(appAiPrompts.mode, mode),
				),
			);
		return { success: true };
	}
}
