import config from "@/config";
import { DEFAULT_SCHEDULER_TZ } from "@/modules/tracking/tracking.types";
import { createLogger } from "@/utils/logger";
import { localClock } from "./ratings.clock";
import { RatingsService } from "./ratings.service";
import type { RatingStoreType } from "./ratings.types";

const log = createLogger("ratings-scheduler");

/**
 * Local hour (scheduler timezone) the daily ratings refresh starts. A quiet
 * slot: rank checks run at 00:00 and 12:00, the keyword-score refresh at
 * 01:00, the Apple Ads sync at 02:00, the Monday audit sweep at 03:00 and
 * auto-research at 06:00, all on the same shared store throttle.
 */
export const RATINGS_REFRESH_HOUR = 4;
const TICK_MS = 60_000;

export interface RatingRefreshStateLike {
	completedAt: Date | null;
	day: string;
	nextAttemptAt: Date | null;
}

/**
 * Whether an app's ratings should be refreshed now: from the slot hour on,
 * once per local day. A run cut short (restart, throttled store) is picked
 * up again on a later tick of the same day, after its back-off.
 */
export function isRatingsRefreshDue(
	state: RatingRefreshStateLike | undefined,
	now: Date,
	tz: string,
): boolean {
	const { day, hour } = localClock(now, tz);
	if (hour < RATINGS_REFRESH_HOUR) return false;
	if (!state || state.day !== day) return true;
	if (state.completedAt) return false;
	return !state.nextAttemptAt || state.nextAttemptAt <= now;
}

let running = false;

/**
 * One pass: every due app, App Store and Google Play in parallel lanes (they
 * have separate throttles), apps of one store one after another.
 */
export async function runRatingsTick(
	now: Date,
	tz: string,
	listApps: () => Promise<
		{ appId: string; storeType: RatingStoreType }[]
	> = () => RatingsService.listRefreshableApps(),
): Promise<number> {
	if (running) return 0;
	running = true;
	try {
		const candidates = await listApps();
		const states = await RatingsService.getStates(
			candidates.map((c) => c.appId),
		);
		const due = candidates.filter(
			(c) =>
				!RatingsService.isRefreshing(c.appId) &&
				isRatingsRefreshDue(states.get(c.appId), now, tz),
		);
		if (!due.length) return 0;
		log.info({ apps: due.length }, "Daily ratings refresh starting");
		const lane = async (storeType: RatingStoreType) => {
			for (const app of due.filter((d) => d.storeType === storeType)) {
				await RatingsService.refreshApp(app.appId, { now });
			}
		};
		await Promise.all([lane("app_store"), lane("google_play")]);
		return due.length;
	} catch (err) {
		log.error({ err }, "Daily ratings refresh failed");
		return 0;
	} finally {
		running = false;
	}
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startRatingsScheduler(): void {
	if (config.SCHEDULER_ENABLED === "false") return;
	if (config.NODE_ENV === "test") return;
	if (timer) return;
	const tz = config.SCHEDULER_TZ || DEFAULT_SCHEDULER_TZ;
	timer = setInterval(() => {
		// Detached: a full sweep takes minutes per app and must not stack up.
		void runRatingsTick(new Date(), tz);
	}, TICK_MS);
	log.info({ hour: RATINGS_REFRESH_HOUR, tz }, "Ratings scheduler started");
}

export function stopRatingsScheduler(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}
