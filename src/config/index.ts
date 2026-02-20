import { ArkErrors, type } from "arktype";

const configSchema = type({
	"+": "delete",
	ALLOWED_ORIGINS: "string?",
	DB_URL: "/^postgres:\\/\\//",
	ENCRYPTION_KEY: "string",
	OPENROUTER_API_KEY: "string?",
	PORT: "string?",
});

const config = configSchema({ ...process.env });

if (config instanceof ArkErrors) throw new Error(config.toString());

export default config as Exclude<typeof config, ArkErrors>;
