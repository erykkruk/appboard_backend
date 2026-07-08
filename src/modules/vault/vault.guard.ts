import Elysia from "elysia";
import { matchesPathPattern } from "@/modules/features/features.const";
import { VaultService } from "./vault.service";

/**
 * Store-facing route prefixes whose mutating requests require an unlocked vault.
 * Any action that can touch a connected store is here; local-only domains (AI,
 * research, ASO profiles, app groups, the vault/features endpoints themselves)
 * are intentionally excluded so the app stays usable while locked.
 */
const VAULT_ACTION_ROUTE_PATTERNS = [
	"/stores",
	"/listings",
	"/assets",
	"/publishing",
	"/reviews",
	"/purchases",
	"/subscription-groups",
	"/age-rating",
	"/privacy-declaration",
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Hard vault gate: a mutating action on any store-facing route requires the
 * vault to be unlocked. This fails fast with 423 before business logic runs.
 * The credential layer (`decrypt/encryptCredentials`) remains the ultimate
 * backstop for anything this guard does not cover.
 */
export const vaultActionGuard = new Elysia({
	name: "vault-action-guard",
}).onBeforeHandle(
	{ as: "scoped" },
	async ({
		request,
		workspaceId,
	}: {
		request: Request;
		workspaceId: string | null;
	}) => {
		if (!workspaceId) return;
		if (!MUTATING_METHODS.has(request.method)) return;

		const { pathname } = new URL(request.url);

		// Probing raw (not-yet-stored) credentials neither reads nor writes the
		// vault, so it must stay reachable while locked. The stored-store variant
		// (/stores/:id/verify-access) decrypts credentials and is NOT excluded.
		if (matchesPathPattern(pathname, "/stores/verify-access")) return;

		const isStoreAction = VAULT_ACTION_ROUTE_PATTERNS.some((pattern) =>
			matchesPathPattern(pathname, pattern),
		);
		if (!isStoreAction) return;

		await VaultService.assertUnlockedForAction(workspaceId);
	},
);
