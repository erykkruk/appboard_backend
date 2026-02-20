import Elysia from "elysia";
import { historyParams, historyQuery, rollbackParams } from "./history.schema";
import { HistoryService } from "./history.service";

export const historyController = new Elysia({ prefix: "/apps" })
	.get(
		"/:appId/history",
		async ({ params, query }) => {
			const history = await HistoryService.getHistory(params.appId, {
				field: query.field,
				language: query.language,
			});
			return { history };
		},
		{
			detail: {
				description: "Get change history for an app",
				tags: ["History"],
			},
			params: historyParams,
			query: historyQuery,
		},
	)
	.post(
		"/:appId/history/:historyId/rollback",
		async ({ params }) => {
			return HistoryService.rollback(params.appId, params.historyId);
		},
		{
			detail: {
				description: "Rollback to a previous value",
				tags: ["History"],
			},
			params: rollbackParams,
		},
	);
