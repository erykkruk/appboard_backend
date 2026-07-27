import { describe, expect, it } from "bun:test";
import {
	ANALYTICS_EVENTS,
	captureEvent,
	isAnalyticsConfigured,
	shutdownAnalytics,
} from "@/utils/analytics";

// These assert the disabled path only — with POSTHOG_KEY set in a developer's
// local .env the module would build a real client and send events, so the
// suite skips instead of failing (or worse, polluting the dashboards).
const enabled = isAnalyticsConfigured();

describe("Analytics (PostHog)", () => {
	it.skipIf(enabled)("is disabled when POSTHOG_KEY is unset", () => {
		expect(isAnalyticsConfigured()).toBe(false);
	});

	it.skipIf(enabled)("captureEvent is a silent no-op when disabled", () => {
		expect(() =>
			captureEvent("user-1", ANALYTICS_EVENTS.USER_SIGNED_UP, {
				workspaceId: "ws-1",
			}),
		).not.toThrow();
	});

	it.skipIf(enabled)(
		"shutdown resolves when no client was created",
		async () => {
			await expect(shutdownAnalytics()).resolves.toBeUndefined();
		},
	);

	it("exposes signup as a named constant, not a magic string", () => {
		expect(ANALYTICS_EVENTS.USER_SIGNED_UP).toBe("user_signed_up");
	});
});
