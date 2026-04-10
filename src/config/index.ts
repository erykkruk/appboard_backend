import { ArkErrors, type } from "arktype";

const configSchema = type({
	"+": "delete",
	ALLOWED_ORIGINS: "string?",
	BETTER_AUTH_SECRET: "string",
	BETTER_AUTH_URL: "string?",
	DB_URL: "/^postgres:\\/\\//",
	ENCRYPTION_KEY: "string",
	NODE_ENV: "string?",
	OPENROUTER_API_KEY: "string?",
	OPENROUTER_MODEL: "string?",
	OPENROUTER_URL: "string?",
	PORT: "string?",
	SMTP_FROM: "string?",
	SMTP_HOST: "string?",
	SMTP_PASS: "string?",
	SMTP_PORT: "string?",
	SMTP_USER: "string?",
});

const config = configSchema({ ...process.env });

if (config instanceof ArkErrors) throw new Error(config.toString());

export default config as Exclude<typeof config, ArkErrors>;
