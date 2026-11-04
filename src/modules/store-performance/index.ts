import Elysia, { t } from "elysia";
import { authGuard } from "@/modules/auth";
import {
	verifyAppOwnership,
	verifyStoreOwnership,
} from "@/modules/auth/verify-ownership";
import {
	MAX_REPORT_MONTHS,
	StorePerformanceService,
} from "./store-performance.service";

/** Longest thing the user could paste: a Cloud Console browser URL. */
const BUCKET_INPUT_MAX_LENGTH = 1024;

export const storePerformanceController = new Elysia()
	.use(authGuard)
	.get(
		"/apps/:appId/store-performance",
		async ({ params, query, workspaceId }) => {
			await verifyAppOwnership(params.appId, workspaceId!);
			return StorePerformanceService.report(params.appId, workspaceId!, {
				months: query.months,
				refresh: query.refresh === "true",
			});
		},
		{
			detail: {
				description:
					'Google Play store listing performance per month, read from the Play Console bulk reports bucket of the app\'s Play connection: acquisitions, visitors and conversion by traffic source, top search terms (Play placeholders such as "Other" and "No search terms specified" are listed apart), UTM campaigns, countries and the installs overview when Play wrote those files. Problems (no bucket set, no bulk-report permission, missing bucket) come back as a `status` with a `message` that says how to fix them. iOS apps answer `{ supported: false }`. Cached for 6 hours; `refresh=true` reads the bucket again.',
				tags: ["Store performance"],
			},
			params: t.Object({ appId: t.String({ format: "uuid" }) }),
			query: t.Object({
				months: t.Optional(
					t.Numeric({ maximum: MAX_REPORT_MONTHS, minimum: 1 }),
				),
				refresh: t.Optional(t.String()),
			}),
		},
	)
	.patch(
		"/stores/:storeId/play-reports-bucket",
		async ({ body, params, workspaceId }) => {
			await verifyStoreOwnership(params.storeId, workspaceId!);
			return StorePerformanceService.setBucket(
				params.storeId,
				workspaceId!,
				body.bucket,
			);
		},
		{
			body: t.Object({
				bucket: t.Nullable(t.String({ maxLength: BUCKET_INPUT_MAX_LENGTH })),
			}),
			detail: {
				description:
					"Set the Play Console bulk-reports bucket of a Google Play connection. Accepts pubsite_prod_... or the full gs:// URI from Play Console > Download reports; null or an empty string clears it.",
				tags: ["Store performance"],
			},
			params: t.Object({ storeId: t.String({ format: "uuid" }) }),
		},
	);
