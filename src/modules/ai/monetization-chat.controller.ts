import Elysia from "elysia";
import { ASC_TERRITORIES } from "@/config/const";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import {
	monetizationChatBody,
	monetizationExecuteBody,
} from "./monetization-chat.schema";
import { MonetizationChatService } from "./monetization-chat.service";

export const monetizationChatController = new Elysia({
	prefix: "/ai",
})
	.get(
		"/territories",
		() => {
			return { territories: ASC_TERRITORIES };
		},
		{
			detail: {
				description: "List available App Store territories",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/monetization-chat",
		async ({ body, workspaceId }) => {
			await verifyAppOwnership(body.appId, workspaceId!);
			const stream = await MonetizationChatService.chat(
				body.appId,
				workspaceId!,
				body.messages,
				body.territories,
			);
			return new Response(stream, {
				headers: {
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"Content-Type": "text/event-stream",
				},
			});
		},
		{
			body: monetizationChatBody,
			detail: {
				description: "AI monetization chat with SSE streaming",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/monetization-execute",
		async ({ body, workspaceId }) => {
			await verifyAppOwnership(body.appId, workspaceId!);
			const results = await MonetizationChatService.executePlan(
				body.appId,
				workspaceId!,
				body.plan,
			);
			return { results };
		},
		{
			body: monetizationExecuteBody,
			detail: {
				description: "Execute an approved monetization plan",
				tags: ["AI"],
			},
		},
	);
