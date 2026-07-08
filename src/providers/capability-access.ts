import type { CapabilityAccessStatus } from "./store-provider";

/**
 * Shared helpers for probing whether a connection's credentials actually have
 * access to a capability. A probe test-calls the corresponding store API and we
 * interpret the outcome: success → granted, permission error → missing,
 * anything else → error.
 */

const PERMISSION_STATUS_CODES = new Set([401, 403]);

/** Best-effort extraction of an HTTP status code from a thrown store-API error. */
function statusCodeOf(err: unknown): number | undefined {
	if (typeof err !== "object" || err === null) return undefined;
	const e = err as {
		code?: unknown;
		status?: unknown;
		statusCode?: unknown;
		response?: { status?: unknown };
	};
	for (const candidate of [
		e.status,
		e.statusCode,
		e.code,
		e.response?.status,
	]) {
		if (typeof candidate === "number") return candidate;
		if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
			return Number(candidate);
		}
	}
	return undefined;
}

export function classifyAccessError(err: unknown): {
	status: CapabilityAccessStatus;
	detail?: string;
} {
	const code = statusCodeOf(err);
	const message = err instanceof Error ? err.message : String(err);
	if (
		(code && PERMISSION_STATUS_CODES.has(code)) ||
		/permission|forbidden|not authorized|insufficient|access denied/i.test(
			message,
		)
	) {
		return {
			detail:
				"The key does not have permission for this — grant the required role in the store console.",
			status: "missing",
		};
	}
	return { detail: message, status: "error" };
}

/** Run a probe call and classify the result into an access status. */
export async function probeAccess(fn: () => Promise<unknown>): Promise<{
	status: CapabilityAccessStatus;
	detail?: string;
}> {
	try {
		await fn();
		return { status: "granted" };
	} catch (err) {
		return classifyAccessError(err);
	}
}
