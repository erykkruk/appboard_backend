import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import {
	privacyDeclarationParams,
	upsertPrivacyDeclarationBody,
} from "./privacy-declaration.schema";
import { PrivacyDeclarationService } from "./privacy-declaration.service";
import { PRIVACY_TEMPLATES } from "./privacy-declaration.templates";

export const privacyTemplatesController = new Elysia().get(
	"/privacy-templates",
	() => {
		return { templates: PRIVACY_TEMPLATES };
	},
	{
		detail: {
			description: "List all privacy declaration templates",
			tags: ["Privacy Declaration"],
		},
	},
);

export const privacyDeclarationController = new Elysia({
	prefix: "/apps/:appId/privacy-declaration",
})
	.get(
		"/",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const declaration = await PrivacyDeclarationService.get(params.appId);
			return { privacyDeclaration: declaration };
		},
		{
			detail: {
				description: "Get privacy declaration for an app",
				tags: ["Privacy Declaration"],
			},
			params: privacyDeclarationParams,
		},
	)
	.put(
		"/",
		async ({ params, body, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			const declaration = await PrivacyDeclarationService.upsert(
				params.appId,
				body,
			);
			return { privacyDeclaration: declaration };
		},
		{
			body: upsertPrivacyDeclarationBody,
			detail: {
				description: "Auto-save privacy declaration to local DB",
				tags: ["Privacy Declaration"],
			},
			params: privacyDeclarationParams,
		},
	)
	.post(
		"/publish",
		async ({ params, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return PrivacyDeclarationService.publish(params.appId);
		},
		{
			detail: {
				description: "Publish privacy declaration to store",
				tags: ["Privacy Declaration"],
			},
			params: privacyDeclarationParams,
		},
	);
