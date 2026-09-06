import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/utils/db";
import { publicToolUsage } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("free-tool-quota");

/** Daily allowance per tool, counted per visitor (IP and cookie both). */
export const FREE_TOOL_LIMITS = {
	/** Full app check-ups per day. */
	"aso-check": 2,
	/** Individual keywords scored per day. */
	"keyword-check": 5,
} as const;

export type FreeTool = keyof typeof FREE_TOOL_LIMITS;

export const FREE_TOOLS = Object.keys(FREE_TOOL_LIMITS) as FreeTool[];

const RETENTION_DAYS = 7;

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

interface Subject {
	kind: "ip" | "cookie";
	value: string;
}

async function usedFor(
	day: string,
	tool: FreeTool,
	subject: Subject,
): Promise<number> {
	const [row] = await db
		.select({ used: publicToolUsage.used })
		.from(publicToolUsage)
		.where(
			and(
				eq(publicToolUsage.day, day),
				eq(publicToolUsage.tool, tool),
				eq(publicToolUsage.subjectKind, subject.kind),
				eq(publicToolUsage.subject, subject.value),
			),
		)
		.limit(1);
	return row?.used ?? 0;
}

/**
 * Daily quota for the free tools. Every visitor is tracked twice - by hashed
 * IP and by a cookie id - and the HIGHER count wins, so neither clearing
 * cookies nor hopping IPs alone resets the allowance. Quota is advisory, not
 * a security boundary: the tools stay usable, they just stop being free
 * beyond the daily allowance.
 */
export class FreeToolQuotaService {
	/** Remaining units per tool for this visitor. */
	static async status(subjects: Subject[]) {
		const day = today();
		const entries = await Promise.all(
			FREE_TOOLS.map(async (tool) => {
				const counts = await Promise.all(
					subjects.map((subject) => usedFor(day, tool, subject)),
				);
				const used = Math.max(0, ...counts);
				const limit = FREE_TOOL_LIMITS[tool];
				return [
					tool,
					{ limit, remaining: Math.max(0, limit - used), used },
				] as const;
			}),
		);
		return Object.fromEntries(entries) as Record<
			FreeTool,
			{ limit: number; remaining: number; used: number }
		>;
	}

	/**
	 * Consume `units` of a tool's daily allowance. Returns `allowed: false`
	 * with the remaining count when the request would exceed it - nothing is
	 * consumed in that case.
	 */
	static async consume(subjects: Subject[], tool: FreeTool, units: number) {
		const day = today();
		const limit = FREE_TOOL_LIMITS[tool];
		const counts = await Promise.all(
			subjects.map((subject) => usedFor(day, tool, subject)),
		);
		const used = Math.max(0, ...counts);
		if (used + units > limit) {
			return {
				allowed: false,
				limit,
				remaining: Math.max(0, limit - used),
				used,
			};
		}

		// Both subjects are advanced to the same total, so the pair stays in
		// sync even when one of them is brand new (fresh cookie, new IP).
		const next = used + units;
		for (const subject of subjects) {
			await db
				.insert(publicToolUsage)
				.values({
					day,
					subject: subject.value,
					subjectKind: subject.kind,
					tool,
					used: next,
				})
				.onConflictDoUpdate({
					set: {
						updatedAt: new Date(),
						used: sql`greatest(${publicToolUsage.used}, ${next})`,
					},
					target: [
						publicToolUsage.day,
						publicToolUsage.tool,
						publicToolUsage.subjectKind,
						publicToolUsage.subject,
					],
				});
		}
		return { allowed: true, limit, remaining: limit - next, used: next };
	}

	/** Drop rows older than the retention window. */
	static async cleanup(): Promise<number> {
		const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
			.toISOString()
			.slice(0, 10);
		const removed = await db
			.delete(publicToolUsage)
			.where(lt(publicToolUsage.day, cutoff))
			.returning({ id: publicToolUsage.id });
		if (removed.length) {
			log.info({ removed: removed.length }, "Free-tool quota cleanup");
		}
		return removed.length;
	}
}
