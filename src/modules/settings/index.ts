import Elysia, { t } from "elysia";
import {
	getAllDefaultPrompts,
	getSettingKey,
	LISTING_FIELDS,
	PROMPT_MODES,
} from "@/modules/ai/ai.prompts";
import {
	getAllDefaultMonetizationPrompts,
	getAllDefaultPurchasePrompts,
	getMonetizationSettingKey,
	getPurchaseSettingKey,
	MONETIZATION_CHAT_FIELDS,
	MONETIZATION_GUIDE_SECTIONS,
	type MonetizationChatField,
	PURCHASE_FIELDS,
	PURCHASE_PROMPT_MODES,
	type PurchasePromptField,
	type PurchasePromptMode,
} from "@/modules/ai/monetization.prompts";
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
	// Monetization chat prompts
	.get(
		"/monetization-prompts",
		async ({ workspaceId }) => {
			const defaults = getAllDefaultMonetizationPrompts();
			const prompts: Record<
				string,
				{
					customPrompt: string | null;
					defaultPrompt: string;
					isDefault: boolean;
				}
			> = {};

			for (const { key } of MONETIZATION_CHAT_FIELDS) {
				const settingKey = getMonetizationSettingKey(key);
				const customValue = await SettingsService.getRaw(
					workspaceId!,
					settingKey,
				);
				prompts[settingKey] = {
					customPrompt: customValue,
					defaultPrompt: defaults[settingKey],
					isDefault: !customValue,
				};
			}

			return { prompts };
		},
		{
			detail: {
				description: "Get all monetization chat prompts (custom + default)",
				tags: ["Settings"],
			},
		},
	)
	.get(
		"/monetization-prompts/defaults",
		() => ({ defaults: getAllDefaultMonetizationPrompts() }),
		{
			detail: {
				description: "Get default monetization chat prompts",
				tags: ["Settings"],
			},
		},
	)
	.put(
		"/monetization-prompts/:field",
		async ({ body, params, workspaceId }) => {
			const settingKey = getMonetizationSettingKey(
				params.field as MonetizationChatField,
			);
			await SettingsService.set(workspaceId!, settingKey, body.prompt);
			return { key: settingKey, success: true };
		},
		{
			body: promptBody,
			detail: {
				description: "Set a custom monetization chat prompt",
				tags: ["Settings"],
			},
			params: t.Object({ field: t.String({ minLength: 1 }) }),
		},
	)
	.delete(
		"/monetization-prompts/:field",
		async ({ params, workspaceId }) => {
			const settingKey = getMonetizationSettingKey(
				params.field as MonetizationChatField,
			);
			await SettingsService.delete(workspaceId!, settingKey);
			return { key: settingKey, success: true };
		},
		{
			detail: {
				description: "Reset a monetization chat prompt to default",
				tags: ["Settings"],
			},
			params: t.Object({ field: t.String({ minLength: 1 }) }),
		},
	)
	// Purchase field prompts
	.get(
		"/purchase-prompts",
		async ({ workspaceId }) => {
			const defaults = getAllDefaultPurchasePrompts();
			const prompts: Record<
				string,
				{
					customPrompt: string | null;
					defaultPrompt: string;
					isDefault: boolean;
				}
			> = {};

			for (const { key } of PURCHASE_FIELDS) {
				for (const mode of PURCHASE_PROMPT_MODES) {
					const settingKey = getPurchaseSettingKey(key, mode);
					const customValue = await SettingsService.getRaw(
						workspaceId!,
						settingKey,
					);
					prompts[settingKey] = {
						customPrompt: customValue,
						defaultPrompt: defaults[settingKey],
						isDefault: !customValue,
					};
				}
			}

			return { prompts };
		},
		{
			detail: {
				description: "Get all purchase field prompts (custom + default)",
				tags: ["Settings"],
			},
		},
	)
	.get(
		"/purchase-prompts/defaults",
		() => ({ defaults: getAllDefaultPurchasePrompts() }),
		{
			detail: {
				description: "Get default purchase field prompts",
				tags: ["Settings"],
			},
		},
	)
	.put(
		"/purchase-prompts/:mode/:field",
		async ({ body, params, workspaceId }) => {
			const settingKey = getPurchaseSettingKey(
				params.field as PurchasePromptField,
				params.mode as PurchasePromptMode,
			);
			await SettingsService.set(workspaceId!, settingKey, body.prompt);
			return { key: settingKey, success: true };
		},
		{
			body: promptBody,
			detail: {
				description: "Set a custom purchase field prompt",
				tags: ["Settings"],
			},
			params: promptModeFieldParams,
		},
	)
	.delete(
		"/purchase-prompts/:mode/:field",
		async ({ params, workspaceId }) => {
			const settingKey = getPurchaseSettingKey(
				params.field as PurchasePromptField,
				params.mode as PurchasePromptMode,
			);
			await SettingsService.delete(workspaceId!, settingKey);
			return { key: settingKey, success: true };
		},
		{
			detail: {
				description: "Reset a purchase field prompt to default",
				tags: ["Settings"],
			},
			params: promptModeFieldParams,
		},
	)
	// Monetization guide
	.get(
		"/monetization-guide",
		() => ({ sections: MONETIZATION_GUIDE_SECTIONS }),
		{
			detail: {
				description: "Get monetization guide content",
				tags: ["Settings"],
			},
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
