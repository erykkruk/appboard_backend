import { ArkErrors, type } from "arktype";

const configSchema = type({
	"+": "delete",
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
	// Opt-in (dev/test only): enables the X-Test-User-Id auth bypass outside
	// the test runner. Never honored when NODE_ENV=production.
	ENABLE_TEST_AUTH: "string?",
	// 32-byte AES-256-GCM key, i.e. exactly 64 hex chars (openssl rand -hex 32).
	// Validated here so a misconfigured key fails fast instead of corrupting
	// encrypted credentials at first use.
	ENCRYPTION_KEY: "/^[0-9a-fA-F]{64}$/",
	GOOGLE_CLIENT_ID: "string?",
	GOOGLE_CLIENT_SECRET: "string?",
	GP_SERVICE_ACCOUNT_KEY_PATH: "string?",
	GP_TEST_PACKAGE_NAME: "string?",
	NODE_ENV: "string?",
	OPENROUTER_API_KEY: "string?",
	OPENROUTER_MODEL: "string?",
	OPENROUTER_URL: "string?",
	PORT: "string?",
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
