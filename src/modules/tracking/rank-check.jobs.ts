import { and, desc, eq } from "drizzle-orm";
import { AppsService } from "@/modules/apps/apps.service";
import { db } from "@/utils/db";
import { rankCheckRuns, trackedKeywords } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	describeStoreError,
	STORE_DEFERRED_CODE,
	storeErrorCode,
} from "./rank-lookup";
import { rankTrackingSupport } from "./rank-support";
import { type RankCheckProgress, TrackingService } from "./tracking.service";
import type {
	RankCheckKind,
	RankCheckResult,
	RankCheckStatus,
	RankLookupFailure,
} from "./tracking.types";

const log = createLogger("rank-check-jobs");

/** Write progress to the run row every N lookups (the panel polls it). */
const PROGRESS_FLUSH_EVERY = 5;
/** Failures kept on the row; the counter keeps counting past this. */
const MAX_STORED_FAILURES = 200;

type RunRow = typeof rankCheckRuns.$inferSelect;

/** What the API returns for a run. */
export interface RankCheckRunView {
	appId: string;
	checked: number;
	error: string | null;
	failed: number;
	failures: RankLookupFailure[];
	finishedAt: Date | null;
	id: string;
	kind: string;
	measured: number;
	/** 0..1 share of tracked keywords looked up so far. */
	progress: number;
	ranked: number;
	startedAt: Date;
	status: RankCheckStatus;
	total: number;
}

export interface RankCheckHooks {
	onComplete?: (result: RankCheckResult) => Promise<void>;
}

interface ActiveJob {
	done: Promise<void>;
	runId: string | null;
	started: Promise<RunRow>;
}

/**
 * One rank check per app at a time, in this process. The map is the lock:
 * the scheduler and "Check now" both go through `start`, so a slow run (700
 * keywords at 3.5 s each is ~40 min) can never be doubled by the next slot or
 * an impatient click. The DB row is only the status the panel polls.
 */
const active = new Map<string, ActiveJob>();

function toView(row: RunRow): RankCheckRunView {
	return {
		appId: row.appId,
		checked: row.checked,
		error: row.error,
		failed: row.failed,
		failures: row.failures ?? [],
		finishedAt: row.finishedAt,
		id: row.id,
		kind: row.kind,
		measured: row.measured,
		progress: row.total ? Math.min(1, row.checked / row.total) : 1,
		ranked: row.ranked,
		startedAt: row.startedAt,
		status: row.status as RankCheckStatus,
		total: row.total,
	};
}

function progressColumns(p: RankCheckProgress) {
	return {
		checked: p.checked,
		failed: p.failed,
		failures: p.failures.slice(0, MAX_STORED_FAILURES),
		measured: p.measured,
		ranked: p.ranked,
	};
}

export class RankCheckJobs {
	/**
	 * Start a background rank check, or return the one already running for
	 * this app (`alreadyRunning: true`). Rejects with 422 when the app's store
	 * exposes no searchable results (tvOS-only App Store records).
	 */
	static async start(
		appId: string,
		workspaceId: string,
		kind: RankCheckKind,
		hooks: RankCheckHooks = {},
	): Promise<{ alreadyRunning: boolean; run: RankCheckRunView }> {
		const current = active.get(appId);
		if (current) {
			const row = await current.started;
			return {
				alreadyRunning: true,
				run: await RankCheckJobs.get(appId, workspaceId, row.id),
			};
		}

		// Reserve the slot synchronously - every await below is a window in
		// which a second caller would otherwise slip past the check above.
		const entry: ActiveJob = {
			done: Promise.resolve(),
			runId: null,
			started: RankCheckJobs.begin(appId, workspaceId, kind),
		};
		active.set(appId, entry);
		const release = () => {
			if (active.get(appId) === entry) active.delete(appId);
		};
		entry.done = entry.started
			.then((row) => {
				entry.runId = row.id;
				return RankCheckJobs.execute(row, workspaceId, hooks);
			})
			.catch((err) => {
				log.error({ appId, err, kind }, "Rank check job failed to start");
			})
			.finally(release);

		const row = await entry.started;
		return { alreadyRunning: false, run: toView(row) };
	}

	/** Like `start`, but silently skips apps whose store cannot be searched. */
	static async startIfSupported(
		appId: string,
		workspaceId: string,
		kind: RankCheckKind,
		hooks: RankCheckHooks = {},
	): Promise<{ alreadyRunning: boolean; run: RankCheckRunView } | null> {
		const app = await AppsService.findOne(workspaceId, appId);
		if (!rankTrackingSupport(app).supported) return null;
		return RankCheckJobs.start(appId, workspaceId, kind, hooks);
	}

	static isRunning(appId: string): boolean {
		return active.has(appId);
	}

	/** Resolves when the app's current run (if any) has finished. */
	static async waitFor(appId: string): Promise<void> {
		await active.get(appId)?.done;
	}

	static async latest(
		appId: string,
		workspaceId: string,
	): Promise<RankCheckRunView | null> {
		const [row] = await db
			.select()
			.from(rankCheckRuns)
			.where(
				and(
					eq(rankCheckRuns.appId, appId),
					eq(rankCheckRuns.workspaceId, workspaceId),
				),
			)
			.orderBy(desc(rankCheckRuns.createdAt))
			.limit(1);
		return row ? toView(await RankCheckJobs.reconcile(row)) : null;
	}

	static async get(
		appId: string,
		workspaceId: string,
		runId: string,
	): Promise<RankCheckRunView> {
		const [row] = await db
			.select()
			.from(rankCheckRuns)
			.where(
				and(
					eq(rankCheckRuns.id, runId),
					eq(rankCheckRuns.appId, appId),
					eq(rankCheckRuns.workspaceId, workspaceId),
				),
			)
			.limit(1);
		if (!row) buildError("notFound", { info: "Rank check not found" });
		return toView(await RankCheckJobs.reconcile(row));
	}

	private static async begin(
		appId: string,
		workspaceId: string,
		kind: RankCheckKind,
	): Promise<RunRow> {
		const app = await AppsService.findOne(workspaceId, appId);
		const support = rankTrackingSupport(app);
		if (!support.supported) {
			buildError("validationFailed", {
				code: "RANK_TRACKING_UNSUPPORTED",
				info: support.note ?? "Rank tracking is not available for this app",
			});
		}
		const tracked = await db
			.select({ id: trackedKeywords.id })
			.from(trackedKeywords)
			.where(eq(trackedKeywords.appId, appId));
		const [row] = await db
			.insert(rankCheckRuns)
			.values({
				appId,
				kind,
				status: "running",
				total: tracked.length,
				workspaceId,
			})
			.returning();
		log.info(
			{ appId, kind, runId: row.id, total: row.total },
			"Rank check started",
		);
		return row;
	}

	private static async execute(
		row: RunRow,
		workspaceId: string,
		hooks: RankCheckHooks,
	): Promise<void> {
		let last: RankCheckProgress | null = null;
		let sinceFlush = 0;
		try {
			const result = await TrackingService.runRankCheck(
				row.appId,
				workspaceId,
				row.kind as RankCheckKind,
				{
					onProgress: async (progress) => {
						last = progress;
						sinceFlush++;
						if (sinceFlush < PROGRESS_FLUSH_EVERY) return;
						sinceFlush = 0;
						await db
							.update(rankCheckRuns)
							.set(progressColumns(progress))
							.where(eq(rankCheckRuns.id, row.id));
					},
				},
			);
			const final: RankCheckProgress = last ?? {
				checked: 0,
				failed: 0,
				failures: [],
				measured: 0,
				ranked: 0,
				total: 0,
			};
			await db
				.update(rankCheckRuns)
				.set({
					...progressColumns(final),
					finishedAt: new Date(),
					status: "completed",
					total: result.checked,
				})
				.where(eq(rankCheckRuns.id, row.id));
			if (hooks.onComplete) {
				await hooks.onComplete(result).catch((err) => {
					log.error({ appId: row.appId, err }, "Rank check follow-up failed");
				});
			}
		} catch (err) {
			const message = describeStoreError(err).message;
			// A run queued behind one the store refused is not broken: it never
			// started. "interrupted" (not "failed") + the reason, so the panel
			// shows it as stopped early rather than as an error of its own.
			const deferred = storeErrorCode(err) === STORE_DEFERRED_CODE;
			if (deferred) {
				log.warn({ appId: row.appId, runId: row.id }, "Rank check deferred");
			} else {
				log.error(
					{ appId: row.appId, err, runId: row.id },
					"Rank check failed",
				);
			}
			await db
				.update(rankCheckRuns)
				.set({
					...(last ? progressColumns(last) : {}),
					error: message.slice(0, 1000),
					finishedAt: new Date(),
					status: deferred ? "interrupted" : "failed",
				})
				.where(eq(rankCheckRuns.id, row.id));
		}
	}

	/**
	 * A row still "running" that no job in this process owns was left behind
	 * by a restart - say so instead of polling it forever.
	 */
	private static async reconcile(row: RunRow): Promise<RunRow> {
		if (row.status !== "running") return row;
		const owner = active.get(row.appId);
		if (owner && (owner.runId === null || owner.runId === row.id)) return row;
		const [updated] = await db
			.update(rankCheckRuns)
			.set({
				error: "Interrupted by a server restart",
				finishedAt: new Date(),
				status: "interrupted",
			})
			.where(eq(rankCheckRuns.id, row.id))
			.returning();
		return updated ?? row;
	}
}
