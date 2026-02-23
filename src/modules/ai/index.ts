import Elysia from "elysia";
import {
	draftReplyBody,
	generateDescriptionBody,
	generateListingFieldBody,
	generatePrivacyBody,
	generateReleaseNotesBody,
	suggestCategoryBody,
	suggestKeywordsBody,
	translateBody,
} from "./ai.schema";
import { AIService } from "./ai.service";

export const aiController = new Elysia({ prefix: "/ai" })
	.post(
		"/generate-listing-field",
		async ({ body }) => {
			const { model, result } = await AIService.generateListingField(
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
		async ({ body }) => {
			return AIService.translate(body.text, body.targetLanguages);
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
		"/generate-description",
		async ({ body }) => {
			return AIService.generateDescription(
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
		async ({ body }) => {
			return AIService.suggestKeywords(
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
		async ({ body }) => {
			return AIService.draftReply(
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
		async ({ body }) => {
			const { model, result } = await AIService.generatePrivacyDeclaration(
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
		async ({ body }) => {
			return AIService.generateReleaseNotes(
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
		async ({ body }) => {
			return AIService.suggestCategory(
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
