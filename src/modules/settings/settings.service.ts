import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { settings } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

const SENSITIVE_KEYS = ["OPENROUTER_API_KEY"];

export class SettingsService {
	static async getAll() {
		const rows = await db.select().from(settings);
		return rows.map((row) => ({
			...row,
			value: row.isEncrypted ? "********" : row.value,
		}));
	}

	static async get(key: string) {
		const [row] = await db
			.select()
			.from(settings)
			.where(eq(settings.key, key))
			.limit(1);

		if (!row) {
			buildError("notFound", { info: `Setting '${key}' not found` });
			throw new Error("unreachable");
		}

		return {
			...row,
			value: row.isEncrypted ? decrypt(row.value!) : row.value,
		};
	}

	static async getRaw(key: string): Promise<string | null> {
		const [row] = await db
			.select()
			.from(settings)
			.where(eq(settings.key, key))
			.limit(1);

		if (!row) return null;
		return row.isEncrypted && row.value ? decrypt(row.value) : row.value;
	}

	static async set(key: string, value: string) {
		const isEncrypted = SENSITIVE_KEYS.includes(key);
		const storedValue = isEncrypted ? encrypt(value) : value;

		const existing = await db
			.select()
			.from(settings)
			.where(eq(settings.key, key))
			.limit(1);

		if (existing.length > 0) {
			await db
				.update(settings)
				.set({ isEncrypted, value: storedValue })
				.where(eq(settings.key, key));
		} else {
			await db.insert(settings).values({
				isEncrypted,
				key,
				value: storedValue,
			});
		}

		return { key, success: true };
	}

	static async update(data: Record<string, string>) {
		const results = [];
		for (const [key, value] of Object.entries(data)) {
			results.push(await SettingsService.set(key, value));
		}
		return { updated: results.length };
	}
}
