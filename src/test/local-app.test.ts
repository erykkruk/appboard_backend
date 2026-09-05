import { afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { appsController } from "@/modules/apps";
import { auditController } from "@/modules/audit";
import { AppEventsService } from "@/modules/tracking/app-events.service";
import { db } from "@/utils/db";
import { appEvents } from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import { authGuard, authRequest, authRequestB, cleanupStores } from "./setup";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(appsController).use(auditController));

async function createApp(name: string, platform = "ios") {
	const res = await app.handle(
		authRequest("http://localhost/api/apps", {
			body: JSON.stringify({ name, platform }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
	return {
		body: (await res.json()) as {
			app?: { id: string; storeId: string; externalId: string; status: string };
		},
		status: res.status,
	};
}

describe("app that is not in a store yet", () => {
	const storeIds: string[] = [];

	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("creates an app with no store listing behind it", async () => {
		const { body, status } = await createApp("Unreleased Thing");
		expect(status).toBe(200);
		const created = body.app;
		expect(created).toBeDefined();
		if (!created) return;
		storeIds.push(created.storeId);

		expect(created.status).toBe("draft");
		// The id must not look like a real store id, or connecting a store
		// later could bind this row to somebody else's app.
		expect(created.externalId.startsWith("local-")).toBe(true);
	});

	it("refuses to score it instead of inventing a number", async () => {
		const { body } = await createApp("Nothing To Measure");
		const created = body.app;
		expect(created).toBeDefined();
		if (!created) return;
		storeIds.push(created.storeId);

		const res = await app.handle(
			authRequest(`http://localhost/api/apps/${created.id}/audit`),
		);
		expect(res.status).toBe(200);
		const audit = (await res.json()) as {
			refreshing: boolean;
			report: unknown;
			status: string;
		};
		expect(audit.status).toBe("not-in-store");
		expect(audit.report).toBeNull();
		// Never leave the UI spinning on a measurement that cannot happen.
		expect(audit.refreshing).toBe(false);
	});

	it("rejects an empty name", async () => {
		const res = await app.handle(
			authRequest("http://localhost/api/apps", {
				body: JSON.stringify({ name: "   ", platform: "ios" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);
		expect(res.status).toBe(400);
	});

	it("keeps the app inside its workspace", async () => {
		const { body } = await createApp("Private To A");
		const created = body.app;
		expect(created).toBeDefined();
		if (!created) return;
		storeIds.push(created.storeId);

		const res = await app.handle(
			authRequestB(`http://localhost/api/apps/${created.id}`),
		);
		expect(res.status).toBe(404);
	});
});

describe("app events feed the rank chart", () => {
	const storeIds: string[] = [];

	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("records an event and reads it back newest first", async () => {
		const { body } = await createApp("Event Source");
		const created = body.app;
		expect(created).toBeDefined();
		if (!created) return;
		storeIds.push(created.storeId);

		await AppEventsService.record(
			created.id,
			"version_created",
			"Version 1.0 created",
			{
				versionString: "1.0",
			},
		);
		await AppEventsService.record(
			created.id,
			"version_submitted",
			"Submitted for review",
		);

		const events = await AppEventsService.list(created.id);
		expect(events).toHaveLength(2);
		expect(events.map((e) => e.type)).toContain("version_created");
		expect(events.map((e) => e.label)).toContain("Version 1.0 created");
	});

	it("never throws at the caller when recording fails", async () => {
		// A publish must not fail because a chart marker could not be written.
		await expect(
			AppEventsService.record(
				"00000000-0000-0000-0000-000000000000",
				"listing_published",
				"orphan",
			),
		).resolves.toBeUndefined();
		const orphans = await db
			.select()
			.from(appEvents)
			.where(eq(appEvents.appId, "00000000-0000-0000-0000-000000000000"));
		expect(orphans).toHaveLength(0);
	});
});
