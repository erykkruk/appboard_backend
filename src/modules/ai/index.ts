import Elysia from "elysia";
import {
	draftReplyBody,
	generateDescriptionBody,
	generateReleaseNotesBody,
	suggestKeywordsBody,
	translateBody,
} from "./ai.schema";
import { AIService } from "./ai.service";

export const aiController = new Elysia({ prefix: "/ai" })
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
	);
