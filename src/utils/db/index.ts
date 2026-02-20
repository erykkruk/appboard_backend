import { drizzle } from "drizzle-orm/bun-sql";
import config from "@/config";
import * as relations from "./relations";
import { schema } from "./schema";

export const db = drizzle(config.DB_URL, {
	casing: "snake_case",
	schema: { ...schema, ...relations },
});
