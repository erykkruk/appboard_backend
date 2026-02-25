import { and, eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/utils/crypto";
import { db } from "@/utils/db";
import { settings } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";

const SENSITIVE_KEYS = ["OPENROUTER_API_KEY"];

function normalizeKey(key: string): string {
	return key.toUpperCase();
}

export class SettingsService {
	static async getAll(workspaceId: string) {
		const rows = await db
			.select()
			.from(settings)
			.where(eq(settings.workspaceId, workspaceId));
		return rows.map((row) => ({
			...row,
			value: row.isEncrypted ? "********" : row.value,
		}));
	}

	static async get(workspaceId: string, key: string) {
		const k = normalizeKey(key);
		const [row] = await db
			.select()
			.from(settings)
			.where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)))
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

	static async getRaw(
		workspaceId: string,
		key: string,
	): Promise<string | null> {
		const k = normalizeKey(key);
		const [row] = await db
			.select()
			.from(settings)
			.where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)))
			.limit(1);

		if (!row) return null;
		return row.isEncrypted && row.value ? decrypt(row.value) : row.value;
	}

	static async set(workspaceId: string, key: string, value: string) {
		const k = normalizeKey(key);
		const isEncrypted = SENSITIVE_KEYS.includes(k);

		if (isEncrypted && value === "********") return { key: k, success: true };

		const storedValue = isEncrypted ? encrypt(value) : value;

		const existing = await db
			.select()
			.from(settings)
			.where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)))
			.limit(1);

		if (existing.length > 0) {
			await db
				.update(settings)
				.set({ isEncrypted, value: storedValue })
				.where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)));
		} else {
			await db.insert(settings).values({
				isEncrypted,
				key: k,
				value: storedValue,
				workspaceId,
			});
		}

		return { key: k, success: true };
	}

	static async delete(workspaceId: string, key: string) {
		const k = normalizeKey(key);
		await db
			.delete(settings)
			.where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, k)));
		return { key: k, success: true };
	}

	static async update(workspaceId: string, data: Record<string, string>) {
		const entries = Object.entries(data);
		for (const [key, value] of entries) {
			await SettingsService.set(workspaceId, key, value);
		}
		const allSettings = await SettingsService.getAll(workspaceId);
		return { settings: allSettings, updated: entries.length };
	}
}
