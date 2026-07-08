import { and, asc, eq, max } from "drizzle-orm";
import { db } from "@/utils/db";
import { aiChatMessages } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

const MAX_MESSAGES = 10;

export class AiChatHistoryService {
	static async getMessages(
		workspaceId: string,
		appId: string,
		chatType: string,
	) {
		return db
			.select()
			.from(aiChatMessages)
			.where(
				and(
					eq(aiChatMessages.workspaceId, workspaceId),
					eq(aiChatMessages.appId, appId),
					eq(aiChatMessages.chatType, chatType),
				),
			)
			.orderBy(asc(aiChatMessages.sortOrder));
	}

	static async addMessage(
		workspaceId: string,
		appId: string,
		chatType: string,
		role: string,
		content: string,
	) {
		const existing = await db
			.select()
			.from(aiChatMessages)
			.where(
				and(
					eq(aiChatMessages.workspaceId, workspaceId),
					eq(aiChatMessages.appId, appId),
					eq(aiChatMessages.chatType, chatType),
				),
			);

		if (existing.length >= MAX_MESSAGES) {
			throw buildError("validationFailed", {
				info: `Message limit of ${MAX_MESSAGES} reached. Clear the conversation to continue.`,
			});
		}

		const [maxResult] = await db
			.select({ maxOrder: max(aiChatMessages.sortOrder) })
			.from(aiChatMessages)
			.where(
				and(
					eq(aiChatMessages.workspaceId, workspaceId),
					eq(aiChatMessages.appId, appId),
					eq(aiChatMessages.chatType, chatType),
				),
			);

		const nextOrder = (maxResult?.maxOrder ?? -1) + 1;

		const [message] = await db
			.insert(aiChatMessages)
			.values({
				appId,
				chatType,
				content,
				role,
				sortOrder: nextOrder,
				workspaceId,
			})
			.returning();

		return message;
	}

	static async clearMessages(
		workspaceId: string,
		appId: string,
		chatType: string,
	) {
		await db
			.delete(aiChatMessages)
			.where(
				and(
					eq(aiChatMessages.workspaceId, workspaceId),
					eq(aiChatMessages.appId, appId),
					eq(aiChatMessages.chatType, chatType),
				),
			);
	}
}
