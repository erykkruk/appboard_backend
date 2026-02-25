import Elysia from "elysia";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import {
	draftReplyBody,
	generateDescriptionBody,
	generateListingFieldBody,
	generatePrivacyBody,
	generateReleaseNotesBody,
	suggestCategoryBody,
	suggestKeywordsBody,
	translateBody,
	translateLocalizationBody,
} from "./ai.schema";
import { AIService } from "./ai.service";

export const aiController = new Elysia({ prefix: "/ai" })
	.post(
		"/generate-listing-field",
		async ({ body, workspaceId }) => {
			await verifyAppOwnership(body.appId, workspaceId!);
			const { model, result } = await AIService.generateListingField(
				workspaceId!,
				body.field,
				body.appId,
				body.appName,
				body.platform,
				body.language,
				body.currentValue,
			);
			return { mock: false, model, result };
		},
		{
			body: generateListingFieldBody,
			detail: {
				description: "Generate or rephrase a listing field using AI",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/translate",
		async ({ body, workspaceId }) => {
			return AIService.translate(workspaceId!, body.text, body.targetLanguages);
		},
		{
			body: translateBody,
			detail: {
				description: "Translate listing text",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/translate-localization",
		async ({ body, workspaceId }) => {
			await verifyAppOwnership(body.appId, workspaceId!);
			return AIService.translateLocalization(
				workspaceId!,
				body.appId,
				body.appName,
				body.platform,
				body.fields,
				body.sourceLanguage,
				body.targetLanguage,
			);
		},
		{
			body: translateLocalizationBody,
			detail: {
				description: "Translate localization fields with ASO context",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/generate-description",
		async ({ body, workspaceId }) => {
			return AIService.generateDescription(
				workspaceId!,
				body.appName,
				body.prompt,
				body.platform,
				body.keywords,
			);
		},
		{
			body: generateDescriptionBody,
			detail: {
				description: "Generate app description",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/suggest-keywords",
		async ({ body, workspaceId }) => {
			return AIService.suggestKeywords(
				workspaceId!,
				body.appName,
				body.description,
				body.category,
				body.currentKeywords,
			);
		},
		{
			body: suggestKeywordsBody,
			detail: {
				description: "Suggest ASO keywords",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/draft-reply",
		async ({ body, workspaceId }) => {
			return AIService.draftReply(
				workspaceId!,
				body.reviewText,
				body.rating,
				body.authorName,
				body.tone,
			);
		},
		{
			body: draftReplyBody,
			detail: {
				description: "Draft a review reply",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/generate-privacy",
		async ({ body, workspaceId }) => {
			const { model, result } = await AIService.generatePrivacyDeclaration(
				workspaceId!,
				body.appName,
				body.description,
			);
			return { mock: false, model, result };
		},
		{
			body: generatePrivacyBody,
			detail: {
				description: "Generate privacy declaration using AI",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/generate-release-notes",
		async ({ body, workspaceId }) => {
			return AIService.generateReleaseNotes(
				workspaceId!,
				body.appName,
				body.version,
				body.changes,
			);
		},
		{
			body: generateReleaseNotesBody,
			detail: {
				description: "Generate release notes",
				tags: ["AI"],
			},
		},
	)
	.post(
		"/suggest-category",
		async ({ body, workspaceId }) => {
			await verifyAppOwnership(body.appId, workspaceId!);
			return AIService.suggestCategory(
				workspaceId!,
				body.appId,
				body.appName,
				body.platform,
				body.description,
			);
		},
		{
			body: suggestCategoryBody,
			detail: {
				description: "Suggest best app category using AI",
				tags: ["AI"],
			},
		},
	);
