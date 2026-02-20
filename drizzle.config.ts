import { type Config, defineConfig } from "drizzle-kit";
import config from "@/config";

export default defineConfig({
	casing: "snake_case",
	dbCredentials: { url: config.DB_URL },
	dialect: "postgresql",
	introspect: { casing: "camel" },
	out: "./src/utils/db/drizzle",
	schema: "./src/utils/db/schema.ts",
}) satisfies Config;
