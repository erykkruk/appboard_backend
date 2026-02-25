import Elysia, { t } from "elysia";
import {
	getAllDefaultPrompts,
	getSettingKey,
	LISTING_FIELDS,
	PROMPT_MODES,
} from "@/modules/ai/ai.prompts";
import {
	setSettingBody,
	settingKeyParams,
	updateSettingsBody,
} from "./settings.schema";
import { SettingsService } from "./settings.service";

const promptModeFieldParams = t.Object({
	field: t.String({ minLength: 1 }),
	mode: t.Union([t.Literal("generate"), t.Literal("rephrase")]),
});

const promptBody = t.Object({
	prompt: t.String({ minLength: 1 }),
});

export const settingsController = new Elysia({ prefix: "/settings" })
	.get(
		"/",
		async ({ workspaceId }) => {
			const result = await SettingsService.getAll(workspaceId!);
			return { settings: result };
		},
		{
			detail: {
				description: "Get all settings",
				tags: ["Settings"],
			},
		},
	)
	.patch(
		"/",
		async ({ body, workspaceId }) => {
			return SettingsService.update(
				workspaceId!,
				body as Record<string, string>,
			);
		},
		{
			body: updateSettingsBody,
			detail: {
				description: "Update multiple settings",
				tags: ["Settings"],
			},
		},
	)
	.get(
		"/prompts",
		async ({ workspaceId }) => {
			const defaults = getAllDefaultPrompts();
			const prompts: Record<
				string,
				{
					customPrompt: string | null;
					defaultPrompt: string;
					isDefault: boolean;
				}
			> = {};

			for (const field of LISTING_FIELDS) {
				for (const mode of PROMPT_MODES) {
					const key = getSettingKey(field, mode);
					const customValue = await SettingsService.getRaw(workspaceId!, key);
					prompts[key] = {
						customPrompt: customValue,
						defaultPrompt: defaults[key],
						isDefault: !customValue,
					};
				}
			}

			return { prompts };
		},
		{
			detail: {
				description: "Get all AI prompts (custom value + default)",
				tags: ["Settings"],
			},
		},
	)
	.get(
		"/prompts/defaults",
		() => {
			return { defaults: getAllDefaultPrompts() };
		},
		{
			detail: {
				description: "Get all default AI prompts",
				tags: ["Settings"],
			},
		},
	)
	.put(
		"/prompts/:mode/:field",
		async ({ body, params, workspaceId }) => {
			const key = getSettingKey(
				params.field as Parameters<typeof getSettingKey>[0],
				params.mode as Parameters<typeof getSettingKey>[1],
			);
			await SettingsService.set(workspaceId!, key, body.prompt);
			return { key, success: true };
		},
		{
			body: promptBody,
			detail: {
				description: "Set a custom global AI prompt",
				tags: ["Settings"],
			},
			params: promptModeFieldParams,
		},
	)
	.delete(
		"/prompts/:mode/:field",
		async ({ params, workspaceId }) => {
			const key = getSettingKey(
				params.field as Parameters<typeof getSettingKey>[0],
				params.mode as Parameters<typeof getSettingKey>[1],
			);
			await SettingsService.delete(workspaceId!, key);
			return { key, success: true };
		},
		{
			detail: {
				description: "Reset a global AI prompt to default",
				tags: ["Settings"],
			},
			params: promptModeFieldParams,
		},
	)
	.get(
		"/:key",
		async ({ params, workspaceId }) => {
			const setting = await SettingsService.get(workspaceId!, params.key);
			return { setting };
		},
		{
			detail: {
				description: "Get a specific setting",
				tags: ["Settings"],
			},
			params: settingKeyParams,
		},
	)
	.put(
		"/:key",
		async ({ body, params, workspaceId }) => {
			return SettingsService.set(workspaceId!, params.key, body.value);
		},
		{
			body: setSettingBody,
			detail: {
				description: "Set a specific setting",
				tags: ["Settings"],
			},
			params: settingKeyParams,
		},
	);
