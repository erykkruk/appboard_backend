/**
 * Public demo account — intentionally well-known credentials.
 *
 * The demo workspace is world-readable by design: the website's "Demo" button
 * signs visitors into this account via POST /api/demo/session. All demo data
 * (and any visitor modifications, including a changed password) is wiped and
 * re-seeded from scratch by the daily reset cron (`bun run demo:reset`).
 */
export const DEMO_ACCOUNT = {
	email: "demo@appboard.dev",
	name: "Demo User",
	password: "demo-password-123",
	workspaceName: "AppBoard Demo",
} as const;
