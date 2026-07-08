import Elysia, { t } from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { AppAiPromptsService } from "./app-ai-prompts.service";

const promptParams = t.Object({
	appId: t.String({ minLength: 1 }),
	field: t.String({ minLength: 1 }),
	mode: t.Union([
		t.Literal("generate"),
		t.Literal("rephrase"),
		t.Literal("chat"),
	]),
});

const promptBody = t.Object({
	prompt: t.String({ minLength: 1 }),
});

export const appAiPromptsController = new Elysia({
	prefix: "/apps/:appId/ai-prompts",
})
	.get(
		"/",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const prompts = await AppAiPromptsService.getAll(params.appId);
			return { prompts };
		},
		{
			detail: {
				description: "List all custom AI prompts for an app",
				tags: ["App AI Prompts"],
			},
			params: t.Object({ appId: t.String({ minLength: 1 }) }),
		},
	)
	.put(
		"/:mode/:field",
		async ({ body, params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const prompt = await AppAiPromptsService.upsert(
				params.appId,
				params.field,
				params.mode,
				body.prompt,
			);
			return { prompt };
		},
		{
			body: promptBody,
			detail: {
				description: "Set a custom AI prompt for an app field",
				tags: ["App AI Prompts"],
			},
			params: promptParams,
		},
	)
	.delete(
		"/:mode/:field",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return AppAiPromptsService.delete(
				params.appId,
				params.field,
				params.mode,
			);
		},
		{
			detail: {
				description: "Reset an app AI prompt to default",
				tags: ["App AI Prompts"],
			},
			params: promptParams,
		},
	);
