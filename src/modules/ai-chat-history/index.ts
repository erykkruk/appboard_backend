import Elysia, { t } from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { AiChatHistoryService } from "./ai-chat-history.service";

const chatHistoryQuery = t.Object({
	appId: t.String({ minLength: 1 }),
	chatType: t.String({ minLength: 1 }),
});

const addMessageBody = t.Object({
	appId: t.String({ minLength: 1 }),
	chatType: t.String({ minLength: 1 }),
	content: t.String({ minLength: 1 }),
	role: t.Union([t.Literal("user"), t.Literal("assistant")]),
});

export const aiChatHistoryController = new Elysia({
	prefix: "/ai/chat-history",
})
	.get(
		"/",
		async ({ query, workspaceId }) => {
			await verifyAppOwnership(query.appId, workspaceId!);
			const messages = await AiChatHistoryService.getMessages(
				workspaceId!,
				query.appId,
				query.chatType,
			);
			return { messages };
		},
		{
			detail: {
				description: "Get chat history for an app",
				tags: ["AI Chat History"],
			},
			query: chatHistoryQuery,
		},
	)
	.post(
		"/",
		async ({ body, workspaceId }) => {
			await verifyAppOwnership(body.appId, workspaceId!);
			const message = await AiChatHistoryService.addMessage(
				workspaceId!,
				body.appId,
				body.chatType,
				body.role,
				body.content,
			);
			return { message };
		},
		{
			body: addMessageBody,
			detail: {
				description: "Add a message to chat history",
				tags: ["AI Chat History"],
			},
		},
	)
	.delete(
		"/",
		async ({ query, workspaceId }) => {
			await verifyAppOwnership(query.appId, workspaceId!);
			await AiChatHistoryService.clearMessages(
				workspaceId!,
				query.appId,
				query.chatType,
			);
			return { success: true };
		},
		{
			detail: {
				description: "Clear chat history for an app",
				tags: ["AI Chat History"],
			},
			query: chatHistoryQuery,
		},
	);
