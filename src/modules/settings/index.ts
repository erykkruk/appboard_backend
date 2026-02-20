import Elysia from "elysia";
import {
	setSettingBody,
	settingKeyParams,
	updateSettingsBody,
} from "./settings.schema";
import { SettingsService } from "./settings.service";

export const settingsController = new Elysia({ prefix: "/settings" })
	.get(
		"/",
		async () => {
			const result = await SettingsService.getAll();
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
		async ({ body }) => {
			return SettingsService.update(body as Record<string, string>);
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
		"/:key",
		async ({ params }) => {
			const setting = await SettingsService.get(params.key);
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
		async ({ body, params }) => {
			return SettingsService.set(params.key, body.value);
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
