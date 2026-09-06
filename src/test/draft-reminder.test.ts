import { afterAll, describe, expect, it } from "bun:test";
import { AppEventsService } from "@/modules/tracking/app-events.service";
import { DraftReminderService } from "@/modules/tracking/draft-reminder.service";
import { db } from "@/utils/db";
import { apps, appTrackingConfig, listings, stores } from "@/utils/db/schema";
import { cleanupStores, getTestWorkspaceId } from "./setup";

const DAY = 24 * 60 * 60 * 1000;

async function seed(daysOld: number, email: string | null) {
	const [store] = await db
		.insert(stores)
		.values({
			connectionMode: "public",
			name: "App Store (public)",
			status: "connected",
			type: "app_store",
			workspaceId: getTestWorkspaceId(),
		})
		.returning();
	const [app] = await db
		.insert(apps)
		.values({
			bundleId: "com.example.draft",
			externalId: `draft-${Math.random().toString(36).slice(2)}`,
			name: "Drafty",
			platform: "ios",
			storeId: store.id,
		})
		.returning();
	const stamp = new Date(Date.now() - daysOld * DAY);
	await db.insert(listings).values({
		appId: app.id,
		fullDesc: "A draft",
		isDirty: true,
		language: "en-US",
		source: "draft",
		title: "Drafty",
		updatedAt: stamp,
	});
	await db.insert(appTrackingConfig).values({
		appId: app.id,
		notifyEmail: email,
		workspaceId: getTestWorkspaceId(),
	});
	return { appId: app.id, storeId: store.id };
}

describe("draft reminders", () => {
	const storeIds: string[] = [];
	afterAll(async () => {
		await cleanupStores(storeIds);
	});

	it("is due for a stale dirty draft with an email on file", async () => {
		const { appId, storeId } = await seed(4, "owner@example.com");
		storeIds.push(storeId);
		const due = await DraftReminderService.findDue();
		const mine = due.find((d) => d.appId === appId);
		expect(mine).toBeDefined();
		expect(mine?.email).toBe("owner@example.com");
		expect(mine?.languages).toEqual(["en-US"]);
	});

	it("is not due for a fresh draft or without an email", async () => {
		const fresh = await seed(1, "owner@example.com");
		const silent = await seed(10, null);
		storeIds.push(fresh.storeId, silent.storeId);
		const due = await DraftReminderService.findDue();
		expect(due.some((d) => d.appId === fresh.appId)).toBe(false);
		expect(due.some((d) => d.appId === silent.appId)).toBe(false);
	});

	it("respects the cooldown once a reminder was recorded", async () => {
		const { appId, storeId } = await seed(5, "owner@example.com");
		storeIds.push(storeId);
		await AppEventsService.record(appId, "draft_reminder_sent", "sent");
		const due = await DraftReminderService.findDue();
		expect(due.some((d) => d.appId === appId)).toBe(false);
	});

	it("writes a plain, honest message", () => {
		const due = {
			appId: "x",
			appName: "Drafty",
			canPublish: true,
			email: "owner@example.com",
			languages: ["en-US", "pl"],
			oldestDraftAt: new Date(Date.now() - 4 * DAY),
		};
		const msg = DraftReminderService.buildMessage(due, new Date());
		expect(msg.subject).toContain("Drafty");
		expect(msg.text).toContain("4 days");
		expect(msg.text).toContain("en-US, pl");
		expect(msg.text).toContain("push it");

		// No store API: the draft leaves by copy and paste, and the email
		// must say so instead of promising a push that would 403.
		const byHand = DraftReminderService.buildMessage(
			{ ...due, canPublish: false },
			new Date(),
		);
		expect(byHand.text).toContain("I pasted it into the store");
		expect(byHand.text).not.toContain("push it");
		expect(byHand.html).toContain("I pasted it into the store");
	});
});
