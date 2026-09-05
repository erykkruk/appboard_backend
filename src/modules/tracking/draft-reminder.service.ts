import { and, eq, gt, isNotNull, lt } from "drizzle-orm";
import { db } from "@/utils/db";
import {
	appEvents,
	apps,
	appTrackingConfig,
	listings,
} from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";
import { type MailMessage, sendMail } from "@/utils/mailer";
import { AppEventsService } from "./app-events.service";

const log = createLogger("draft-reminder");

/** A draft older than this with nothing published is worth a nudge. */
const DRAFT_AGE_DAYS = 3;
/** Never nag: one reminder per app per week, whatever happens in between. */
const REMINDER_COOLDOWN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DueDraftReminder {
	appId: string;
	appName: string;
	email: string;
	languages: string[];
	oldestDraftAt: Date;
}

export class DraftReminderService {
	/**
	 * Apps with an unpublished draft that has been sitting for a while, whose
	 * owner asked for email, and who were not reminded within the cooldown.
	 * Pure query, so the scheduler wiring stays trivially testable.
	 */
	static async findDue(now = new Date()): Promise<DueDraftReminder[]> {
		const staleBefore = new Date(now.getTime() - DRAFT_AGE_DAYS * DAY_MS);
		const cooldownSince = new Date(
			now.getTime() - REMINDER_COOLDOWN_DAYS * DAY_MS,
		);

		const rows = await db
			.select({
				appId: apps.id,
				appName: apps.name,
				email: appTrackingConfig.notifyEmail,
				language: listings.language,
				updatedAt: listings.updatedAt,
			})
			.from(listings)
			.innerJoin(apps, eq(listings.appId, apps.id))
			.innerJoin(appTrackingConfig, eq(appTrackingConfig.appId, apps.id))
			.where(
				and(
					eq(listings.source, "draft"),
					eq(listings.isDirty, true),
					lt(listings.updatedAt, staleBefore),
					isNotNull(appTrackingConfig.notifyEmail),
				),
			);
		if (rows.length === 0) return [];

		const recent = await db
			.select({ appId: appEvents.appId })
			.from(appEvents)
			.where(
				and(
					eq(appEvents.type, "draft_reminder_sent"),
					gt(appEvents.occurredAt, cooldownSince),
				),
			);
		const cooled = new Set(recent.map((r) => r.appId));

		const byApp = new Map<string, DueDraftReminder>();
		for (const row of rows) {
			if (cooled.has(row.appId) || !row.email) continue;
			const entry = byApp.get(row.appId) ?? {
				appId: row.appId,
				appName: row.appName,
				email: row.email,
				languages: [],
				oldestDraftAt: row.updatedAt,
			};
			entry.languages.push(row.language);
			if (row.updatedAt < entry.oldestDraftAt)
				entry.oldestDraftAt = row.updatedAt;
			byApp.set(row.appId, entry);
		}
		return [...byApp.values()];
	}

	static buildMessage(
		due: DueDraftReminder,
		now: Date,
	): Omit<MailMessage, "to"> {
		const days = Math.max(
			1,
			Math.floor((now.getTime() - due.oldestDraftAt.getTime()) / DAY_MS),
		);
		const langs = due.languages.join(", ");
		const text = [
			`${due.appName} has an unpublished draft (${langs}) that has been waiting for ${days} days.`,
			"Nothing reaches the store until you publish it. Open AppBoard, review the diff and push it - or discard it.",
		].join("\n\n");
		const html = `<p><strong>${escapeHtml(due.appName)}</strong> has an unpublished draft (${escapeHtml(langs)}) that has been waiting for ${days} days.</p><p>Nothing reaches the store until you publish it. Open AppBoard, review the diff and push it - or discard it.</p>`;
		return {
			html,
			subject: `AppBoard - a draft for ${due.appName} is still unpublished`,
			text,
		};
	}

	/** Sends every due reminder; a failure on one app never blocks the rest. */
	static async runScheduled(now = new Date()): Promise<number> {
		const due = await DraftReminderService.findDue(now);
		let sent = 0;
		for (const item of due) {
			try {
				const ok = await sendMail({
					...DraftReminderService.buildMessage(item, now),
					to: item.email,
				});
				if (!ok) continue;
				sent += 1;
				// The event doubles as the cooldown marker, so no extra state.
				await AppEventsService.record(
					item.appId,
					"draft_reminder_sent",
					"Draft reminder emailed",
					{ languages: item.languages },
				);
			} catch (err) {
				log.error({ appId: item.appId, err }, "Draft reminder failed");
			}
		}
		if (due.length > 0) log.info({ due: due.length, sent }, "Draft reminders");
		return sent;
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
