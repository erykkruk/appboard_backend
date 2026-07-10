import { ArkErrors, type } from "arktype";

const configSchema = type({
	"+": "delete",
	// Bootstrap admin (self-hosting without SMTP): when both are set and the user
	// doesn't exist yet, an owner account is created on startup so you can log in
	// with email + password instead of an email OTP.
	ADMIN_EMAIL: "string?",
	ADMIN_PASSWORD: "string?",
	ALLOWED_ORIGINS: "string?",
	// Sign in with Apple. Native-app bundle id is optional (only needed for
	// verifying id tokens issued to a native iOS client, not the web flow).
	APPLE_APP_BUNDLE_ID: "string?",
	APPLE_CLIENT_ID: "string?",
	APPLE_CLIENT_SECRET: "string?",
	// Min 32 chars — used to sign Better Auth sessions. A weak secret here
	// weakens every session token, so reject short values at startup.
	BETTER_AUTH_SECRET: "string >= 32",
	BETTER_AUTH_URL: "string?",
	DB_URL: "/^postgres:\\/\\//",
	// Deployment edition. "cloud" = our hosted SaaS (shows cloud-only features
	// like billing); anything else (incl. unset) = self-hosted (those are hidden).
	// Fail-safe: only an explicit "cloud" unlocks cloud-only features.
	DEPLOYMENT_MODE: "string?",
	// Opt-in (dev/test only): enables the X-Test-User-Id auth bypass outside
	// the test runner. Never honored when NODE_ENV=production.
	ENABLE_TEST_AUTH: "string?",
	// 32-byte AES-256-GCM key, i.e. exactly 64 hex chars (openssl rand -hex 32).
	// Validated here so a misconfigured key fails fast instead of corrupting
	// encrypted credentials at first use.
	ENCRYPTION_KEY: "/^[0-9a-fA-F]{64}$/",
	// Recipient for the public product-feedback form. Set per-deployment so the
	// address is never hardcoded in the (public) source.
	FEEDBACK_EMAIL: "string?",
	GOOGLE_CLIENT_ID: "string?",
	GOOGLE_CLIENT_SECRET: "string?",
	GP_SERVICE_ACCOUNT_KEY_PATH: "string?",
	GP_TEST_PACKAGE_NAME: "string?",
	// Listmonk newsletter integration (optional) — feedback submitters are added
	// as subscribers. All four must be set for it to activate.
	LISTMONK_LIST_ID: "string?",
	LISTMONK_TOKEN: "string?",
	LISTMONK_URL: "string?",
	LISTMONK_USERNAME: "string?",
	NODE_ENV: "string?",
	OPENROUTER_API_KEY: "string?",
	OPENROUTER_MODEL: "string?",
	OPENROUTER_URL: "string?",
	PORT: "string?",
	// Background scheduler (rank tracking + auto-research). Set to "false" to
	// disable the in-process timer (e.g. when running a second instance that
	// must not double-run scheduled jobs). Always disabled under the test runner.
	SCHEDULER_ENABLED: "string?",
	// IANA timezone the daily 00:00 / 12:00 rank checks are anchored to.
	SCHEDULER_TZ: "string?",
	SEED_USER_EMAIL: "string?",
	SEED_USER_NAME: "string?",
	SMTP_FROM: "string?",
	SMTP_HOST: "string?",
	SMTP_PASS: "string?",
	SMTP_PORT: "string?",
	SMTP_USER: "string?",
});

const config = configSchema({ ...process.env });

if (config instanceof ArkErrors) throw new Error(config.toString());

export default config as Exclude<typeof config, ArkErrors>;
