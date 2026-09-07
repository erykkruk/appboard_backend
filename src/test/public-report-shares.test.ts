import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { publicReportsController } from "@/modules/public-reports";
import { PublicReportsService } from "@/modules/public-reports/public-reports.service";
import { db } from "@/utils/db";
import { publicReportShares } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
// Side-effect import: boots the app once (runs DB migrations) for the suite.
import "./setup";

const app = new Elysia().use(errorHandler).use(publicReportsController);

const APP_NAME = "Share Test App";
const SHARE_URL = "http://localhost/api/public/aso-reports/share";

function post(body: unknown) {
	return app.handle(
		new Request(SHARE_URL, {
			body: JSON.stringify(body),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}),
	);
}

function get(id: string) {
	return app.handle(new Request(`${SHARE_URL}/${id}`));
}

function validShare() {
	return {
		appName: APP_NAME,
		country: "all",
		payload: {
			markets: [
				{
					audit: { asoScore: 61, issues: [], strengths: [], themes: [] },
					country: "us",
					scores: [{ keyword: "habit tracker", opportunity: 55 }],
				},
			],
			mode: "all",
			store: "appstore",
			version: 1,
		},
		store: "appstore",
		tool: "aso-check",
		trackId: "999000222",
	};
}

async function cleanup() {
	await db
		.delete(publicReportShares)
		.where(eq(publicReportShares.appName, APP_NAME));
}

afterEach(cleanup);

describe("POST /api/public/aso-reports/share", () => {
	it("keeps the snapshot and hands back a link id, no auth needed", async () => {
		const res = await post(validShare());
		expect(res.status).toBe(200);
		const body = (await res.json()) as { id: string };
		expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

		const [row] = await db
			.select()
			.from(publicReportShares)
			.where(eq(publicReportShares.id, body.id));
		expect(row.country).toBe("all");
		expect(row.store).toBe("appstore");
		expect(row.tool).toBe("aso-check");
		expect(row.trackId).toBe("999000222");
		expect(row.ipHash).toHaveLength(64);
		expect((row.payload as { mode: string }).mode).toBe("all");
	});

	it("rejects an unknown tool, a bad country and a non-object payload", async () => {
		expect((await post({ ...validShare(), tool: "editor" })).status).toBe(422);
		expect((await post({ ...validShare(), country: "usa" })).status).toBe(422);
		expect((await post({ ...validShare(), payload: [1, 2] })).status).toBe(422);
	});

	it("refuses a payload above the size cap", async () => {
		const res = await post({
			...validShare(),
			payload: { blob: "x".repeat(4 * 1024 * 1024 + 1), version: 1 },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { data?: { info?: string } };
		expect(body.data?.info).toContain("too large");
	});
});

describe("GET /api/public/aso-reports/share/:id", () => {
	it("returns the stored snapshot with its metadata", async () => {
		const { id } = (await (await post(validShare())).json()) as {
			id: string;
		};
		const res = await get(id);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toContain("max-age=300");
		const body = (await res.json()) as {
			appName: string;
			country: string;
			createdAt: string;
			id: string;
			payload: { markets: unknown[] };
			tool: string;
		};
		expect(body.id).toBe(id);
		expect(body.appName).toBe(APP_NAME);
		expect(body.country).toBe("all");
		expect(body.tool).toBe("aso-check");
		expect(body.createdAt).toBeTruthy();
		expect(body.payload.markets).toHaveLength(1);
		expect(body).not.toHaveProperty("ipHash");
	});

	it("answers 404 for an unknown id and 422 for a malformed one", async () => {
		expect((await get(crypto.randomUUID())).status).toBe(404);
		expect((await get("not-a-uuid")).status).toBe(422);
	});
});

describe("PublicReportsService.cleanupShares", () => {
	it("drops shares older than the retention window and keeps fresh ones", async () => {
		const stale = new Date(Date.now() - 400 * 86_400_000);
		const [old] = await db
			.insert(publicReportShares)
			.values({
				appName: APP_NAME,
				country: "us",
				createdAt: stale,
				ipHash: "0".repeat(64),
				payload: { version: 1 },
				tool: "aso-check",
			})
			.returning({ id: publicReportShares.id });
		const { id: fresh } = (await (await post(validShare())).json()) as {
			id: string;
		};

		const removed = await PublicReportsService.cleanupShares();

		expect(removed).toBeGreaterThanOrEqual(1);
		expect((await get(old.id)).status).toBe(404);
		expect((await get(fresh)).status).toBe(200);
	});
});
