import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { researchController } from "@/modules/research";
import { ResearchService } from "@/modules/research/research.service";
import { storesController } from "@/modules/stores";
import { trackingController } from "@/modules/tracking";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceIdB,
} from "@/test/setup";
import { seedTestApp, seedTestStore } from "@/test/test-helpers";
import { errorHandler } from "@/utils/errors/errorHandler";

const BASE = "http://localhost/api";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) =>
		a
			.use(storesController)
			.use(appsController)
			.use(researchController)
			.use(trackingController),
	);

let appId: string;
const storeIds: string[] = [];

const META = {
	country: "us",
	developer: "Test Dev",
	id: "123456",
	store: "appstore" as const,
	title: "Test App",
	url: "https://apps.apple.com/us/app/foo/id123456",
};

function reportBody(extra?: Record<string, unknown>) {
	return {
		report: {
			heuristics: {
				buckets: [],
				byStars: {},
				negative: 0,
				negativeShare: 0,
				total: 0,
			},
			meta: META,
			reviewsCount: 0,
			...extra,
		},
	};
}

async function json(res: Response) {
	return (await res.json()) as Record<string, unknown>;
}

beforeAll(async () => {
	const store = await seedTestStore();
	storeIds.push(store.id);
	const seeded = await seedTestApp(store.id);
	appId = seeded.id;

	const storeB = await seedTestStore(getTestWorkspaceIdB());
	storeIds.push(storeB.id);
});

afterAll(async () => {
	await cleanupStores(storeIds);
});

describe("Research run persistence", () => {
	let runId: string;

	it("saves a standalone research run", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/research/runs`, {
				body: JSON.stringify(reportBody()),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			run: { id: string; title: string; appId: string | null };
		};
		expect(body.run.id).toBeTruthy();
		expect(body.run.title).toBe("Test App");
		expect(body.run.appId).toBeNull();
		runId = body.run.id;
	});

	it("lists standalone runs", async () => {
		const res = await app.handle(authRequest(`${BASE}/research/runs`));
		expect(res.status).toBe(200);
		const body = (await json(res)) as { runs: Array<{ id: string }> };
		expect(body.runs.some((r) => r.id === runId)).toBe(true);
	});

	it("fetches a run with its full report", async () => {
		const res = await app.handle(authRequest(`${BASE}/research/runs/${runId}`));
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			run: { report: { reviewsCount: number } };
		};
		expect(body.run.report.reviewsCount).toBe(0);
	});

	it("deletes a run", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/research/runs/${runId}`, { method: "DELETE" }),
		);
		expect(res.status).toBe(200);
		const gone = await app.handle(
			authRequest(`${BASE}/research/runs/${runId}`),
		);
		expect(gone.status).toBe(404);
	});
});

describe("Per-app research runs", () => {
	it("runs research for a connected app and lists it under the app", async () => {
		const spy = spyOn(ResearchService, "scrape").mockResolvedValue({
			heuristics: {
				buckets: [],
				byStars: {},
				negative: 0,
				negativeShare: 0,
				total: 0,
			},
			meta: { ...META, store: "playstore" },
			reviews: [],
		});
		try {
			const res = await app.handle(
				authRequest(`${BASE}/apps/${appId}/research-runs/run`, {
					body: JSON.stringify({ country: "us" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				}),
			);
			expect(res.status).toBe(200);
			const body = (await json(res)) as { run: { appId: string } };
			expect(body.run.appId).toBe(appId);

			const list = await app.handle(
				authRequest(`${BASE}/apps/${appId}/research-runs`),
			);
			const listed = (await json(list)) as { runs: Array<{ appId: string }> };
			expect(listed.runs.length).toBeGreaterThan(0);
			expect(listed.runs.every((r) => r.appId === appId)).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("Workspace isolation", () => {
	let otherRunId: string;

	it("saves a run in workspace A", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/research/runs`, {
				body: JSON.stringify(reportBody()),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		otherRunId = ((await json(res)) as { run: { id: string } }).run.id;
	});

	it("workspace B cannot read or delete workspace A's run", async () => {
		const read = await app.handle(
			authRequestB(`${BASE}/research/runs/${otherRunId}`),
		);
		expect(read.status).toBe(404);
		const del = await app.handle(
			authRequestB(`${BASE}/research/runs/${otherRunId}`, { method: "DELETE" }),
		);
		expect(del.status).toBe(404);
	});
});
