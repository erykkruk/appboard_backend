import Elysia, { t } from "elysia";
import { authGuard } from "@/modules/auth";
import { verifyAppOwnership } from "@/modules/auth/verify-ownership";
import { AppleAdsService } from "./apple-ads.service";

const country = t.String({ maxLength: 2, minLength: 2 });

const connectBody = t.Object({
	clientId: t.String({ minLength: 1 }),
	keyId: t.String({ minLength: 1 }),
	privateKey: t.String({ minLength: 1 }),
	teamId: t.String({ minLength: 1 }),
});

export const appleAdsController = new Elysia({ prefix: "/apple-ads" })
	.use(authGuard)
	.post(
		"/connect",
		async ({ body, workspaceId }) => {
			return AppleAdsService.connect(workspaceId!, body);
		},
		{
			body: connectBody,
			detail: {
				description:
					"Validate and store Apple Ads API credentials (ES256 key pair) for official search popularity data",
				tags: ["Apple Ads"],
			},
		},
	)
	.delete(
		"/connect",
		async ({ workspaceId }) => {
			return AppleAdsService.disconnect(workspaceId!);
		},
		{
			detail: {
				description: "Remove the stored Apple Ads credentials",
				tags: ["Apple Ads"],
			},
		},
	)
	.get(
		"/status",
		async ({ workspaceId }) => {
			return AppleAdsService.status(workspaceId!);
		},
		{
			detail: {
				description:
					"Connection status, active dataset weeks per country and the selected popularity source",
				tags: ["Apple Ads"],
			},
		},
	)
	.patch(
		"/source",
		async ({ body, workspaceId }) => {
			return AppleAdsService.setSource(workspaceId!, body.source);
		},
		{
			body: t.Object({
				source: t.Union([t.Literal("internal"), t.Literal("apple")]),
			}),
			detail: {
				description:
					"Choose which popularity source feeds keyword scoring: the internal estimate or Apple's official values",
				tags: ["Apple Ads"],
			},
		},
	)
	.post(
		"/sync",
		async ({ body, workspaceId }) => {
			return AppleAdsService.syncCountry(workspaceId!, body.country);
		},
		{
			body: t.Object({ country }),
			detail: {
				description:
					"Download the latest completed weekly top-terms dataset for a country",
				tags: ["Apple Ads"],
			},
		},
	)
	.get(
		"/trend",
		async ({ query }) => {
			const points = await AppleAdsService.trend(query.country, query.term);
			return { points };
		},
		{
			detail: {
				description:
					"Weekly official popularity of one search term across stored weeks",
				tags: ["Apple Ads"],
			},
			query: t.Object({ country, term: t.String({ minLength: 1 }) }),
		},
	)
	.get(
		"/movers",
		async ({ query }) => {
			return AppleAdsService.movers(query.country, query.genre);
		},
		{
			detail: {
				description:
					"Biggest official-popularity movers between the two newest stored weeks",
				tags: ["Apple Ads"],
			},
			query: t.Object({ country, genre: t.Optional(t.String()) }),
		},
	)
	.post(
		"/impressions/sync",
		async ({ body, workspaceId }) => {
			await verifyAppOwnership(body.appId, workspaceId!);
			return AppleAdsService.syncImpressions(workspaceId!, body.appId);
		},
		{
			body: t.Object({ appId: t.String({ minLength: 1 }) }),
			detail: {
				description:
					"Sync impression share for one iOS app (last 4 completed weeks)",
				tags: ["Apple Ads"],
			},
		},
	)
	.get(
		"/impressions",
		async ({ query, workspaceId }) => {
			await verifyAppOwnership(query.appId, workspaceId!);
			const rows = await AppleAdsService.getImpressions(query.appId);
			return { rows };
		},
		{
			detail: {
				description: "Stored impression-share rows for one app",
				tags: ["Apple Ads"],
			},
			query: t.Object({ appId: t.String({ minLength: 1 }) }),
		},
	);
