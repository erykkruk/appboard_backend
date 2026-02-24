import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { settings } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

const SENSITIVE_KEYS = ["OPENROUTER_API_KEY"];

function normalizeKey(key: string): string {
	return key.toUpperCase();
}

export class SettingsService {
	static async getAll() {
		const rows = await db.select().from(settings);
		return rows.map((row) => ({
			...row,
			value: row.isEncrypted ? "********" : row.value,
		}));
	}

	static async get(key: string) {
		const k = normalizeKey(key);
		const [row] = await db
			.select()
			.from(settings)
			.where(eq(settings.key, k))
			.limit(1);

		if (!row) {
			buildError("notFound", { info: `Setting '${k}' not found` });
			throw new Error("unreachable");
		}

		return {
			...row,
			value: row.isEncrypted ? decrypt(row.value!) : row.value,
		};
	}

	static async getRaw(key: string): Promise<string | null> {
		const k = normalizeKey(key);
		const [row] = await db
			.select()
			.from(settings)
			.where(eq(settings.key, k))
			.limit(1);

		if (!row) return null;
		return row.isEncrypted && row.value ? decrypt(row.value) : row.value;
	}

	static async set(key: string, value: string) {
		const k = normalizeKey(key);
		const isEncrypted = SENSITIVE_KEYS.includes(k);

		// Never overwrite a real key with the masked placeholder
		if (isEncrypted && value === "********") return { key: k, success: true };

		const storedValue = isEncrypted ? encrypt(value) : value;

		const existing = await db
			.select()
			.from(settings)
			.where(eq(settings.key, k))
			.limit(1);

		if (existing.length > 0) {
			await db
				.update(settings)
				.set({ isEncrypted, value: storedValue })
				.where(eq(settings.key, k));
		} else {
			await db.insert(settings).values({
				isEncrypted,
				key: k,
				value: storedValue,
			});
		}

		return { key: k, success: true };
	}

	static async delete(key: string) {
		const k = normalizeKey(key);
		await db.delete(settings).where(eq(settings.key, k));
		return { key: k, success: true };
	}

	static async update(data: Record<string, string>) {
		for (const [key, value] of Object.entries(data)) {
			await SettingsService.set(key, value);
		}
		const allSettings = await SettingsService.getAll();
		return { settings: allSettings };
	}
}
