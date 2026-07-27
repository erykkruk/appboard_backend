import { PostHog } from "posthog-node";
import config from "@/config";
import { createLogger } from "@/utils/logger";

const log = createLogger("analytics");

/**
 * Server-side product analytics (PostHog). Optional integration: with no
 * POSTHOG_KEY every call is a no-op, so self-hosted deployments send nothing.
 *
 * Server-side is the only reliable place to count signups - the browser cannot
 * tell a first login from a returning one, especially on the social OAuth flow.
 */

const DEFAULT_HOST = "https://posthog.tools.playbuzzin.com";
// Signup volume is low and we care about freshness, not throughput.
const FLUSH_AT = 1;
const FLUSH_INTERVAL_MS = 5_000;
// Container runtimes SIGKILL after ~10s, so a hung PostHog must not hold the
// process open for posthog-node's 30s default.
const SHUTDOWN_TIMEOUT_MS = 2_000;

/** Event names are a contract with the dashboards - never inline them. */
export const ANALYTICS_EVENTS = {
	USER_SIGNED_UP: "user_signed_up",
} as const;

export type AnalyticsEvent =
	(typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

let client: PostHog | undefined;

export function isAnalyticsConfigured(): boolean {
	return !!config.POSTHOG_KEY;
}

function getClient(): PostHog | undefined {
	if (!config.POSTHOG_KEY) return undefined;
	if (!client) {
		client = new PostHog(config.POSTHOG_KEY, {
			flushAt: FLUSH_AT,
			flushInterval: FLUSH_INTERVAL_MS,
			host: config.POSTHOG_HOST ?? DEFAULT_HOST,
		});
	}
	return client;
}

/**
 * Best-effort event capture - never throws. Callers include the signup hook, so
 * a broken or unreachable PostHog must not be able to fail a registration.
 */
export function captureEvent(
	distinctId: string,
	event: AnalyticsEvent,
	properties?: Record<string, unknown>,
): void {
	try {
		// Client construction is inside the try on purpose: a malformed
		// POSTHOG_HOST throws here, and that must not propagate to the caller.
		const posthog = getClient();
		if (!posthog) return;
		posthog.capture({ distinctId, event, properties });
	} catch (error) {
		log.warn({ err: error, event }, "PostHog capture failed");
	}
}

/** Flush pending events on shutdown so the last signups aren't lost. */
export async function shutdownAnalytics(): Promise<void> {
	if (!client) return;
	try {
		await client.shutdown(SHUTDOWN_TIMEOUT_MS);
	} catch (error) {
		log.warn({ err: error }, "PostHog shutdown failed");
	}
}
