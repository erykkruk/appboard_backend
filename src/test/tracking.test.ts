import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
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
		a.use(storesController).use(appsController).use(trackingController),
	);

let appId: string;
let appIdB: string;
const storeIds: string[] = [];

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
	const seededB = await seedTestApp(storeB.id);
	appIdB = seededB.id;
});

afterAll(async () => {
	await cleanupStores(storeIds);
});

describe("Tracking config", () => {
	it("returns a default (all-off) config for a fresh app", async () => {
		const res = await app.handle(authRequest(`${BASE}/apps/${appId}/tracking`));
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			config: { rankTrackingEnabled: boolean; autoResearchEnabled: boolean };
			keywords: unknown[];
			positions: unknown[];
		};
		expect(body.config.rankTrackingEnabled).toBe(false);
		expect(body.config.autoResearchEnabled).toBe(false);
		expect(body.keywords).toEqual([]);
		expect(body.positions).toEqual([]);
	});

	it("updates automation settings", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/config`, {
				body: JSON.stringify({
					autoResearchFrequency: "daily",
					rankTrackingEnabled: true,
				}),
				headers: { "Content-Type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(res.status).toBe(200);
		const body = (await json(res)) as {
			config: { rankTrackingEnabled: boolean; autoResearchFrequency: string };
		};
		expect(body.config.rankTrackingEnabled).toBe(true);
		expect(body.config.autoResearchFrequency).toBe("daily");
	});
});

describe("Tracked keywords", () => {
	it("adds keywords for a country and dedupes case-insensitively", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords`, {
				body: JSON.stringify({
					country: "us",
					keywords: ["Task Manager", "task manager", "todo"],
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(200);
		const body = (await json(res)) as { keywords: Array<{ keyword: string }> };
		const usKeywords = body.keywords.filter(
			(k) => (k as { country: string }).country === "us",
		);
		expect(usKeywords.map((k) => k.keyword).sort()).toEqual([
			"task manager",
			"todo",
		]);
	});

	it("enforces the 20-keyword-per-language cap", async () => {
		const twenty = Array.from({ length: 20 }, (_, i) => `kw-${i}`);
		const ok = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords`, {
				body: JSON.stringify({ country: "de", keywords: twenty }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(ok.status).toBe(200);

		const over = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords`, {
				body: JSON.stringify({ country: "de", keywords: ["one-too-many"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			}),
		);
		expect(over.status).toBe(422);
	});

	it("removes a keyword", async () => {
		const list = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking`),
		);
		const body = (await json(list)) as {
			keywords: Array<{ id: string; keyword: string; country: string }>;
		};
		const target = body.keywords.find((k) => k.keyword === "todo");
		expect(target).toBeDefined();

		const res = await app.handle(
			authRequest(`${BASE}/apps/${appId}/tracking/keywords/${target?.id}`, {
				method: "DELETE",
			}),
		);
		expect(res.status).toBe(200);
		const del = (await json(res)) as { success: boolean };
		expect(del.success).toBe(true);
	});
});

describe("Rank check", () => {
	it("records a snapshot per tracked keyword and updates history", async () => {
		const spy = spyOn(ResearchService, "positionFor").mockResolvedValue(7);
		try {
			const res = await app.handle(
				authRequest(`${BASE}/apps/${appId}/tracking/check`, {
					method: "POST",
				}),
			);
			expect(res.status).toBe(200);
			const body = (await json(res)) as {
				result: { checked: number; snapshots: number };
			};
			expect(body.result.snapshots).toBe(body.result.checked);
			expect(body.result.snapshots).toBeGreaterThan(0);
			expect(spy).toHaveBeenCalled();

			const history = await app.handle(
				authRequest(`${BASE}/apps/${appId}/tracking/history`),
			);
			const h = (await json(history)) as {
				snapshots: Array<{ position: number | null }>;
				annotations: unknown[];
			};
			expect(h.snapshots.length).toBeGreaterThan(0);
			expect(h.snapshots[0].position).toBe(7);
			expect(Array.isArray(h.annotations)).toBe(true);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("Workspace isolation", () => {
	it("workspace B cannot read workspace A's tracking", async () => {
		const res = await app.handle(
			authRequestB(`${BASE}/apps/${appId}/tracking`),
		);
		expect(res.status).toBe(404);
	});

	it("workspace A cannot read workspace B's tracking", async () => {
		const res = await app.handle(
			authRequest(`${BASE}/apps/${appIdB}/tracking`),
		);
		expect(res.status).toBe(404);
	});
});
