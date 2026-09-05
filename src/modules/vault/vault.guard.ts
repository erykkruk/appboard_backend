import { eq } from "drizzle-orm";
import Elysia from "elysia";
import { authGuard } from "@/modules/auth";
import { matchesPathPattern } from "@/modules/features/features.const";
import { appIdFromPath } from "@/modules/stores/store-capabilities.guard";
import { StoreCapabilitiesService } from "@/modules/stores/store-capabilities.service";
import { db } from "@/utils/db";
import { stores } from "@/utils/db/schema";
import { VaultService } from "./vault.service";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extract the `:storeId` segment from a `/api/stores/:storeId/...` pathname. */
function storeIdFromPath(pathname: string): string | null {
	const segments = pathname.split("/").filter(Boolean);
	const storesIndex = segments.indexOf("stores");
	if (storesIndex === -1) return null;
	const candidate = segments[storesIndex + 1];
	return candidate && UUID_RE.test(candidate) ? candidate : null;
}

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
})
	.use(authGuard)
	.onBeforeHandle({ as: "scoped" }, async ({ request, workspaceId }) => {
		if (!workspaceId) return;
		if (!MUTATING_METHODS.has(request.method)) return;

		const { pathname } = new URL(request.url);

		// Probing raw (not-yet-stored) credentials neither reads nor writes the
		// vault, so it must stay reachable while locked. The stored-store variant
		// (/stores/:id/verify-access) decrypts credentials and is NOT excluded.
		if (matchesPathPattern(pathname, "/stores/verify-access")) return;

		// Importing an app from a public store link is credential-less by
		// design — it must work with a locked (or absent) vault.
		if (matchesPathPattern(pathname, "/stores/import")) return;

		const isStoreAction = VAULT_ACTION_ROUTE_PATTERNS.some((pattern) =>
			matchesPathPattern(pathname, pattern),
		);
		if (!isStoreAction) return;

		// Apps under a public (link) connection never touch credentials: local
		// drafts and public-data syncs stay usable while the vault is locked.
		// Anything that truly needs the store API raises INTEGRATION_REQUIRED
		// from the provider, and decryptCredentials stays the backstop.
		const appId = appIdFromPath(pathname);
		if (appId) {
			const resolved = await StoreCapabilitiesService.getForApp(appId);
			if (resolved?.connectionMode === "public") return;
		}

		// Same for actions on a public connection itself (sync, disconnect).
		const storeId = storeIdFromPath(pathname);
		if (storeId) {
			const [row] = await db
				.select({ connectionMode: stores.connectionMode })
				.from(stores)
				.where(eq(stores.id, storeId))
				.limit(1);
			if (row?.connectionMode === "public") return;
		}

		await VaultService.assertUnlockedForAction(workspaceId);
	});
