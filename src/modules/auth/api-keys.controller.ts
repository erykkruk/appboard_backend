import { Elysia } from "elysia";
import { buildError } from "@/utils/errors";
import { apiKeyIdParams, createApiKeyBody } from "./api-keys.schema";
import { ApiKeysService } from "./api-keys.service";

/**
 * Key management requires a real user session. An API key must never be able to
 * mint or revoke other keys, so requests authenticated via the bearer token
 * (userId === null) are rejected here.
 */
function requireSession(userId: string | null): string {
	if (!userId) {
		buildError("forbidden", {
			info: "API key management requires a user session",
		});
	}
	return userId;
}

export const apiKeysController = new Elysia({ prefix: "/auth/api-keys" })
	.post(
		"/",
		({ body, userId, workspaceId }) => {
			requireSession(userId);
			return ApiKeysService.create(workspaceId!, body.name);
		},
		{
			body: createApiKeyBody,
			detail: {
				description: "Create an API key (token returned once)",
				tags: ["Auth"],
			},
		},
	)
	.get(
		"/",
		({ userId, workspaceId }) => {
			requireSession(userId);
			return ApiKeysService.list(workspaceId!);
		},
		{
			detail: { description: "List API keys", tags: ["Auth"] },
		},
	)
	.delete(
		"/:id",
		({ params, userId, workspaceId }) => {
			requireSession(userId);
			return ApiKeysService.revoke(workspaceId!, params.id);
		},
		{
			detail: { description: "Revoke an API key", tags: ["Auth"] },
			params: apiKeyIdParams,
		},
	);
