import config from "@/config";
import { createLogger } from "@/utils/logger";

const log = createLogger("listmonk");

export function isListmonkConfigured(): boolean {
	return !!(
		config.LISTMONK_URL &&
		config.LISTMONK_USERNAME &&
		config.LISTMONK_TOKEN &&
		config.LISTMONK_LIST_ID
	);
}

/**
 * Add an email to the configured Listmonk list. Best-effort: returns false and
 * logs on any failure instead of throwing, so it never blocks the caller.
 * Idempotent — an already-subscribed email is treated as success.
 */
export async function subscribeToListmonk(
	email: string,
	name?: string,
): Promise<boolean> {
	if (!isListmonkConfigured()) return false;
	try {
		// Listmonk API auth: `token <user>:<token>` (v3+ API users).
		const authHeader = `token ${config.LISTMONK_USERNAME}:${config.LISTMONK_TOKEN}`;
		const base = config.LISTMONK_URL?.replace(/\/$/, "");
		const res = await fetch(`${base}/api/subscribers`, {
			body: JSON.stringify({
				email,
				lists: [Number(config.LISTMONK_LIST_ID)],
				name: name || email.split("@")[0],
				preconfirm_subscriptions: true,
				status: "enabled",
			}),
			headers: {
				Authorization: authHeader,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		if (res.ok) return true;
		// 409 = subscriber already exists → idempotent success.
		if (res.status === 409) return true;
		const body = await res.text().catch(() => "");
		log.warn(
			{ body: body.slice(0, 200), status: res.status },
			"Listmonk subscribe failed",
		);
		return false;
	} catch (err) {
		log.warn({ err }, "Listmonk subscribe error");
		return false;
	}
}
