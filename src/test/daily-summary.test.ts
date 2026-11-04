import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import { dailySummaryController } from "@/modules/daily-summary";
import {
	AUTO_RESEARCH_EVENT,
	DailySummaryService,
} from "@/modules/daily-summary/daily-summary.service";
import type { ResearchRunReport } from "@/modules/research/research.types";
import { reportMail } from "@/modules/tracking/report-mail";
import {
	sendAutoResearchReport,
	sendRankDigest,
} from "@/modules/tracking/scheduler.service";
import {
	authGuard,
	authRequest,
	authRequestB,
	cleanupStores,
	getTestWorkspaceId,
	getTestWorkspaceIdB,
} from "@/test/setup";
import { db } from "@/utils/db";
import {
	appEvents,
	apps,
	appTrackingConfig,
	rankSnapshots,
	researchRuns,
	stores,
	trackedKeywords,
	workspaceDailySummary,
} from "@/utils/db/schema";
import { errorHandler } from "@/utils/errors/errorHandler";
import type { MailMessage } from "@/utils/mailer";

const app = new Elysia()
	.use(errorHandler)
	.use(authGuard)
	.group("/api", (a) => a.use(dailySummaryController));

const BASE = "http://localhost/api/tracking/daily-summary";
const WARSAW = "Europe/Warsaw";
const APP_A = "Summary Quiz Alpha";
const APP_B = "Summary Quiz Bravo";
const PER_APP_EMAIL = "per-app-reports@example.com";
const SUMMARY_EMAIL = "morning-summary@example.com";
const HOUR = 60 * 60 * 1000;

const storeIds: string[] = [];
let appIdA = "";
let appIdB = "";
let sent: MailMessage[] = [];
const realSend = reportMail.send;
const realConfigured = reportMail.isConfigured;

function json(method: string, body?: unknown): RequestInit {
	return {
		body: body === undefined ? undefined : JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
		method,
	};
}

async function seedApp(workspaceId: string, name: string, externalId: string) {
	const [store] = await db
		.insert(stores)
		.values({
			connectionMode: "public",
			name: "App Store (public)",
			status: "connected",
			type: "app_store",
			workspaceId,
		})
		.returning();
	storeIds.push(store.id);
	const [row] = await db
		.insert(apps)
		.values({
			bundleId: `com.example.${externalId}`,
			externalId,
			name,
			platform: "ios",
			storeId: store.id,
		})
		.returning();
	await db.insert(appTrackingConfig).values({
		appId: row.id,
		autoResearchEnabled: true,
		emailRankDigest: true,
		notifyEmail: PER_APP_EMAIL,
		rankTrackingEnabled: true,
		workspaceId,
	});
	return row.id;
}

async function seedRankings(appId: string) {
	const keywords = [
		{ country: "pl", keyword: "quiz party", now: 6, prev: 14, starred: true },
		{
			country: "pl",
			keyword: "trivia night",
			now: 30,
			prev: 21,
			starred: false,
		},
		{ country: "de", keyword: "quizspiel", now: 3, prev: 3, starred: false },
		// The app's own name: never a gain, never counted as earned.
		{
			country: "pl",
			keyword: "summary quiz alpha",
			now: 1,
			prev: 9,
			starred: false,
		},
	];
	await db.insert(trackedKeywords).values(
		keywords.map((k) => ({
			appId,
			country: k.country,
			keyword: k.keyword,
			starred: k.starred,
		})),
	);
	const yesterday = new Date(Date.now() - 24 * HOUR);
	const today = new Date(Date.now() - HOUR);
	await db.insert(rankSnapshots).values(
		keywords.flatMap((k) => [
			{
				appId,
				country: k.country,
				createdAt: yesterday,
				keyword: k.keyword,
				platform: "ios",
				position: k.prev,
			},
			{
				appId,
				country: k.country,
				createdAt: today,
				keyword: k.keyword,
				platform: "ios",
				position: k.now,
			},
		]),
	);
}

async function seedResearch(appId: string, workspaceId: string) {
	const report = {
		analysis: { quickWins: [], summary: "Reviews ask for more quiz packs." },
		heuristics: {
			buckets: [],
			byStars: {},
			negative: 4,
			negativeShare: 0.1,
			total: 40,
		},
		meta: {
			country: "pl",
			developer: "Example",
			id: "1",
			rating: 4.5,
			store: "appstore",
			title: APP_A,
			url: "https://apps.apple.com/pl/app/id1",
		},
		reviewsCount: 40,
	} as unknown as ResearchRunReport;
	const [run] = await db
		.insert(researchRuns)
		.values({
			appId,
			country: "pl",
			kind: "scheduled",
			report,
			title: APP_A,
			workspaceId,
		})
		.returning();
	await db.insert(appEvents).values({
		appId,
		label: "Auto-research (PL)",
		meta: {
			country: "pl",
			markets: 4,
			runId: run.id,
			scored: 17,
			topIdeas: [
				{ country: "pl", keyword: "quiz na impreze", opportunity: 68 },
			],
		},
		type: AUTO_RESEARCH_EVENT,
	});
	return run;
}

async function resetSummaryRows() {
	await db
		.delete(workspaceDailySummary)
		.where(
			inArray(workspaceDailySummary.workspaceId, [
				getTestWorkspaceId(),
				getTestWorkspaceIdB(),
			]),
		);
}

const mine = () => sent.filter((m) => m.to === SUMMARY_EMAIL);

beforeAll(async () => {
	await resetSummaryRows();
	appIdA = await seedApp(getTestWorkspaceId(), APP_A, "summary-alpha");
	appIdB = await seedApp(getTestWorkspaceIdB(), APP_B, "summary-bravo");
	await seedRankings(appIdA);
	await seedRankings(appIdB);
	await seedResearch(appIdA, getTestWorkspaceId());
	reportMail.send = async (message) => {
		sent.push(message);
		return true;
	};
	reportMail.isConfigured = () => true;
});

afterAll(async () => {
	reportMail.send = realSend;
	reportMail.isConfigured = realConfigured;
	await resetSummaryRows();
	await cleanupStores(storeIds);
});

beforeEach(() => {
	sent = [];
});

describe("daily summary settings endpoints", () => {
	it("requires authentication", async () => {
		const res = await app.handle(new Request(BASE));
		expect(res.status).toBe(401);
	});

	it("is off by default and reports what it would cover", async () => {
		const res = await app.handle(authRequest(BASE));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.enabled).toBe(false);
		expect(body.email).toBeNull();
		expect(body.effectiveEmail).toBeTruthy();
		expect(body.trackedApps).toBeGreaterThanOrEqual(1);
		expect(body.schedule).toEqual({ hour: 7, minute: 30, timezone: WARSAW });
	});

	it("updates only the caller's workspace", async () => {
		const res = await app.handle(
			authRequest(BASE, json("PATCH", { email: SUMMARY_EMAIL, enabled: true })),
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.enabled).toBe(true);
		expect(body.email).toBe(SUMMARY_EMAIL);
		expect(body.effectiveEmail).toBe(SUMMARY_EMAIL);

		const other = await (await app.handle(authRequestB(BASE))).json();
		expect(other.enabled).toBe(false);
		expect(other.email).toBeNull();
		expect(await DailySummaryService.isEnabled(getTestWorkspaceIdB())).toBe(
			false,
		);

		// B switching its own summary on and off leaves A alone.
		await app.handle(authRequestB(BASE, json("PATCH", { enabled: true })));
		await app.handle(authRequestB(BASE, json("PATCH", { enabled: false })));
		expect(await DailySummaryService.isEnabled(getTestWorkspaceId())).toBe(
			true,
		);
	});

	it("rejects an invalid email", async () => {
		const res = await app.handle(
			authRequest(BASE, json("PATCH", { email: "not-an-email" })),
		);
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it("clears the address with an empty string (falls back again)", async () => {
		await app.handle(
			authRequestB(BASE, json("PATCH", { email: "b@example.com" })),
		);
		const res = await app.handle(
			authRequestB(BASE, json("PATCH", { email: "" })),
		);
		const body = await res.json();
		expect(body.email).toBeNull();
		expect(body.effectiveEmail).toBe(PER_APP_EMAIL);
	});

	it("test send answers 503 when the server has no SMTP", async () => {
		reportMail.isConfigured = () => false;
		try {
			const res = await app.handle(authRequest(`${BASE}/test`, json("POST")));
			expect(res.status).toBe(503);
			expect((await res.json()).code).toBe("MAIL_UNAVAILABLE");
		} finally {
			reportMail.isConfigured = () => true;
		}
	});

	it("test send mails the workspace's own apps only and does not count as today's summary", async () => {
		const res = await app.handle(authRequest(`${BASE}/test`, json("POST")));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.sent).toBe(true);
		expect(body.to).toBe(SUMMARY_EMAIL);
		const [mail] = mine();
		expect(mail).toBeDefined();
		expect(mail.text).toContain(APP_A);
		expect(mail.text).not.toContain(APP_B);
		const row = await DailySummaryService.getRow(getTestWorkspaceId());
		expect(row?.lastSentOn).toBeNull();
	});
});

describe("collected summary data", () => {
	it("counts without the app's name and lists movers, starred and research", async () => {
		const summary = await DailySummaryService.collect(getTestWorkspaceId());
		const alpha = summary.apps.find((a) => a.appId === appIdA);
		expect(alpha).toBeDefined();
		expect(alpha?.tracked).toBe(4);
		expect(alpha?.ranked).toBe(3);
		expect(alpha?.top10).toBe(2);
		expect(alpha?.gains.map((g) => g.keyword)).toEqual(["quiz party"]);
		expect(alpha?.drops.map((d) => d.keyword)).toEqual(["trivia night"]);
		expect(alpha?.starred).toEqual({
			moved: [expect.objectContaining({ delta: 8, keyword: "quiz party" })],
			top10: 1,
			total: 1,
		});
		expect(alpha?.strongestMarkets.map((m) => m.country)).toEqual(["pl", "de"]);
		expect(alpha?.research).toEqual(
			expect.objectContaining({
				country: "pl",
				ideaMarkets: 4,
				ideasScored: 17,
				rating: 4.5,
				reviewsCount: 40,
				topIdeas: [
					{ country: "pl", keyword: "quiz na impreze", opportunity: 68 },
				],
			}),
		);
		expect(summary.apps.some((a) => a.appId === appIdB)).toBe(false);
	});
});

describe("scheduled daily summary", () => {
	const morning = new Date("2026-11-04T06:30:00Z"); // 07:30 Warsaw

	beforeEach(async () => {
		await db
			.update(workspaceDailySummary)
			.set({ enabled: true, lastSentAt: null, lastSentOn: null })
			.where(eq(workspaceDailySummary.workspaceId, getTestWorkspaceId()));
	});

	it("sends once per local day, a restart in the same window sends nothing", async () => {
		await DailySummaryService.runScheduled(morning, WARSAW);
		expect(mine()).toHaveLength(1);
		expect(mine()[0].subject).toContain("AppBoard daily summary, Wed 4 Nov");

		// Same tick again, a minute later, and a "restart" at 09:00.
		await DailySummaryService.runScheduled(morning, WARSAW);
		await DailySummaryService.runScheduled(
			new Date(morning.getTime() + 60_000),
			WARSAW,
		);
		await DailySummaryService.runScheduled(
			new Date("2026-11-04T08:00:00Z"),
			WARSAW,
		);
		expect(mine()).toHaveLength(1);

		const row = await DailySummaryService.getRow(getTestWorkspaceId());
		expect(row?.lastSentOn).toBe("2026-11-04");
		expect(row?.lastSentAt?.toISOString()).toBe(morning.toISOString());

		// Next morning: due again.
		await DailySummaryService.runScheduled(
			new Date("2026-11-05T06:30:00Z"),
			WARSAW,
		);
		expect(mine()).toHaveLength(2);
	});

	it("does nothing before 07:30 or while disabled", async () => {
		await DailySummaryService.runScheduled(
			new Date("2026-11-04T06:29:00Z"),
			WARSAW,
		);
		await DailySummaryService.updateSettings(getTestWorkspaceId(), {
			enabled: false,
		});
		await DailySummaryService.runScheduled(morning, WARSAW);
		expect(mine()).toHaveLength(0);
	});

	it("waits for a running rank check or research until 09:30, then sends anyway", async () => {
		const busy = (appId: string) => appId === appIdA;
		await DailySummaryService.runScheduled(morning, WARSAW, busy);
		await DailySummaryService.runScheduled(
			new Date("2026-11-04T08:29:00Z"),
			WARSAW,
			busy,
		);
		expect(mine()).toHaveLength(0);
		await DailySummaryService.runScheduled(
			new Date("2026-11-04T08:30:00Z"),
			WARSAW,
			busy,
		);
		expect(mine()).toHaveLength(1);
	});

	it("sends nothing (and logs nothing as sent) without SMTP", async () => {
		reportMail.isConfigured = () => false;
		try {
			expect(await DailySummaryService.runScheduled(morning, WARSAW)).toBe(0);
		} finally {
			reportMail.isConfigured = () => true;
		}
		const row = await DailySummaryService.getRow(getTestWorkspaceId());
		expect(row?.lastSentOn).toBeNull();
	});
});

describe("per-app emails", () => {
	const cfgA = () => ({
		appId: appIdA,
		emailRankDigest: true,
		notifyEmail: PER_APP_EMAIL,
		workspaceId: getTestWorkspaceId(),
	});
	const run = {
		report: {
			heuristics: { buckets: [], negativeShare: 0.1 },
			meta: { country: "pl", rating: 4.5, store: "appstore" },
			reviewsCount: 40,
		},
		title: APP_A,
	};
	const perApp = () => sent.filter((m) => m.to === PER_APP_EMAIL);

	it("are replaced while the daily summary is on", async () => {
		await DailySummaryService.updateSettings(getTestWorkspaceId(), {
			enabled: true,
		});
		expect(await sendRankDigest(cfgA())).toBe(false);
		expect(await sendAutoResearchReport(cfgA(), run)).toBe(false);
		expect(perApp()).toHaveLength(0);
	});

	it("go out exactly as before while it is off", async () => {
		await DailySummaryService.updateSettings(getTestWorkspaceId(), {
			enabled: false,
		});
		expect(await sendRankDigest(cfgA())).toBe(true);
		expect(await sendAutoResearchReport(cfgA(), run)).toBe(true);
		const subjects = perApp().map((m) => m.subject);
		expect(subjects).toHaveLength(2);
		expect(subjects[0]).toEndWith(`daily rankings for ${APP_A}`);
		expect(subjects[1]).toEndWith(`research report for ${APP_A}`);
	});

	it("go out for a workspace that never touched the setting", async () => {
		const cfgB = {
			...cfgA(),
			appId: appIdB,
			workspaceId: getTestWorkspaceIdB(),
		};
		await db
			.delete(workspaceDailySummary)
			.where(eq(workspaceDailySummary.workspaceId, getTestWorkspaceIdB()));
		expect(await sendRankDigest(cfgB)).toBe(true);
		expect(perApp()[0]?.subject).toEndWith(`daily rankings for ${APP_B}`);
	});

	it("respect the per-app digest switch", async () => {
		expect(await sendRankDigest({ ...cfgA(), emailRankDigest: false })).toBe(
			false,
		);
		expect(perApp()).toHaveLength(0);
	});
});
