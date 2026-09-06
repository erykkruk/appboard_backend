import { afterAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { historyController } from "@/modules/history";
import { listingsController } from "@/modules/listings";
import { trackingController } from "@/modules/tracking";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest, authRequestB, cleanupStores } from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) =>
		a
			.use(appsController)
			.use(listingsController)
			.use(historyController)
			.use(trackingController),
	);

const json = (body: unknown) => ({
	body: JSON.stringify(body),
	headers: { "content-type": "application/json" },
});

async function createLocalApp(name: string) {
	const res = await app.handle(
		authRequest("http://localhost/api/apps", {
			...json({ name, platform: "ios" }),
			method: "POST",
		}),
	);
	const body = (await res.json()) as { app: { id: string; storeId: string } };
	return body.app;
}

describe("marking a draft as published by hand", () => {
	const storeIds: string[] = [];

	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("closes the draft, writes history and a chart marker, and seeds the live baseline", async () => {
		const created = await createLocalApp("Pasted By Hand");
		storeIds.push(created.storeId);

		await app.handle(
			authRequest(`http://localhost/api/apps/${created.id}/listings/en-US`, {
				...json({ shortDesc: "Quiz night with friends", title: "Buzz Party" }),
				method: "PUT",
			}),
		);

		const before = await app.handle(
			authRequest(`http://localhost/api/apps/${created.id}/listings/diffs`),
		);
		const beforeDiffs = (await before.json()) as {
			diffs: Array<{ fields: unknown[] }>;
		};
		expect(beforeDiffs.diffs[0]?.fields.length).toBe(2);

		const res = await app.handle(
			authRequest(
				`http://localhost/api/apps/${created.id}/listings/mark-published`,
				{ method: "POST" },
			),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ published: 1 });

		const after = await app.handle(
			authRequest(`http://localhost/api/apps/${created.id}/listings/diffs`),
		);
		expect(((await after.json()) as { diffs: unknown[] }).diffs).toEqual([]);

		const history = await app.handle(
			authRequest(`http://localhost/api/apps/${created.id}/history`),
		);
		const entries = (await history.json()) as {
			history: Array<{
				field: string;
				newValue: string | null;
				oldValue: string | null;
			}>;
		};
		const fields = entries.history.map((h) => h.field).sort();
		expect(fields).toEqual(["shortDesc", "title"]);
		expect(entries.history.find((h) => h.field === "title")).toMatchObject({
			newValue: "Buzz Party",
			oldValue: null,
		});

		const chart = await app.handle(
			authRequest(`http://localhost/api/apps/${created.id}/tracking/history`),
		);
		const chartBody = (await chart.json()) as {
			annotations: Array<{ label: string; type: string }>;
		};
		const marker = chartBody.annotations.find(
			(a) => a.type === "listing_published",
		);
		expect(marker?.label).toContain("by hand");
		expect(
			chartBody.annotations.filter((a) => a.type === "listing_field").length,
		).toBe(2);

		const again = await app.handle(
			authRequest(
				`http://localhost/api/apps/${created.id}/listings/mark-published`,
				{ method: "POST" },
			),
		);
		expect(await again.json()).toEqual({ published: 0 });
	});

	it("is scoped to the workspace that owns the app", async () => {
		const created = await createLocalApp("Somebody Else");
		storeIds.push(created.storeId);

		const res = await app.handle(
			authRequestB(
				`http://localhost/api/apps/${created.id}/listings/mark-published`,
				{ method: "POST" },
			),
		);
		expect(res.status).toBe(404);
	});
});
