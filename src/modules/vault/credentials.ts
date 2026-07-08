import { eq } from "drizzle-orm";
import {
	decrypt,
	decryptWithKey,
	encryptWithKey,
} from "@/utils/crypto";
import { db } from "@/utils/db";
import { workspaceVault } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { vaultSession } from "./vault.session";

/** Ciphertext tag marking a blob encrypted with a workspace vault DEK. */
export const VAULT_PREFIX = "vault:";

/**
 * Decrypt a stored credential blob to its parsed object.
 *
 * - `vault:`-prefixed blobs require the workspace vault to be unlocked (DEK in
 *   memory for this workspace) — otherwise a 423 is raised.
 * - Unprefixed blobs are legacy / vault-disabled and use the server env key.
 */
export function decryptCredentials(
	ciphertext: string,
	workspaceId: string,
): Record<string, unknown> {
	if (ciphertext.startsWith(VAULT_PREFIX)) {
		const dek = vaultSession.getDek(workspaceId);
		if (!dek) {
			buildError("vaultLocked", {
				info: "Vault is locked. Unlock it with your passphrase to access store credentials.",
			});
		}
		return JSON.parse(
			decryptWithKey(dek, ciphertext.slice(VAULT_PREFIX.length)),
		);
	}
	return JSON.parse(decrypt(ciphertext));
}

/**
 * Encrypt a credential blob for storage.
 *
 * Store credentials are ALWAYS wrapped with the workspace vault DEK (derived
 * from the user's passphrase) — never with the server env key — so a server
 * admin with DB + env access cannot read them.
 *
 * - Vault unlocked (DEK in memory) → encrypt with the DEK.
 * - Vault configured but locked → 423 (unlock first).
 * - No vault configured → 428 (set up the vault first). Legacy env-key blobs
 *   remain readable via decryptCredentials and are re-wrapped on vault
 *   setup/unlock by migrateCredentialsToVault.
 */
export async function encryptCredentials(
	creds: Record<string, unknown>,
	workspaceId: string,
): Promise<string> {
	const dek = vaultSession.getDek(workspaceId);
	if (dek) {
		return VAULT_PREFIX + encryptWithKey(dek, JSON.stringify(creds));
	}

	const [vault] = await db
		.select({ id: workspaceVault.id })
		.from(workspaceVault)
		.where(eq(workspaceVault.workspaceId, workspaceId))
		.limit(1);
	if (vault) {
		buildError("vaultLocked", {
			info: "Vault is locked. Unlock it with your passphrase before saving store credentials.",
		});
	}

	buildError("vaultRequired", {
		info: "Credentials vault not configured. Set up your vault (Settings → Vault) before connecting a store.",
	});
}
