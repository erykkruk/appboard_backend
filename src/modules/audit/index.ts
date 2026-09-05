import Elysia, { t } from "elysia";
import { authGuard } from "@/modules/auth";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { AuditService } from "./audit.service";

export const auditController = new Elysia({ prefix: "/apps" })
	.use(authGuard)
	.get(
		"/:appId/audit/suggestions",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return await AuditService.suggestions(params.appId, query.language);
		},
		{
			detail: {
				description:
					"Concrete title / subtitle / keyword-field proposals derived from the stored audit, as before-after pairs. Read-only: accepting one is a normal PUT to the draft listing.",
				tags: ["Audit"],
			},
			params: t.Object({ appId: t.String({ format: "uuid" }) }),
			query: t.Object({ language: t.Optional(t.String({ maxLength: 20 })) }),
		},
	)
	.get(
		"/:appId/audit",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return await AuditService.read(params.appId, workspaceId!, {
				country: query.country,
				language: query.language,
				refresh: query.refresh === "true",
			});
		},
		{
			detail: {
				description:
					'Audit one app\'s listing: the score the store currently serves, the score its unpublished draft would get, the rule-by-rule issues behind both, and the scored keyword candidates the rules used. Reads are instant and cache-first - a stale or first-ever report returns status "measuring" and the real measurement runs in the background, so poll until status is "ready". Same rules engine as the free browser check-up.',
				tags: ["Audit"],
			},
			params: t.Object({ appId: t.String({ format: "uuid" }) }),
			query: t.Object({
				country: t.Optional(t.String({ maxLength: 2, minLength: 2 })),
				language: t.Optional(t.String({ maxLength: 20 })),
				refresh: t.Optional(t.String()),
			}),
		},
	);
