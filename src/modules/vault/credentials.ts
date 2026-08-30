import { eq } from "drizzle-orm";
import {
	decrypt,
	decryptWithKey,
	encrypt,
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
 * Passphrase (E2EE vault) encryption is OPT-IN per workspace. When the vault
 * is enabled, credentials are wrapped with the workspace DEK so a server
 * admin with DB + env access cannot read them; without a vault they fall back
 * to server env-key encryption (the default).
 *
 * - Vault unlocked (DEK in memory) → encrypt with the DEK.
 * - Vault configured but locked → 423 (unlock first).
 * - No vault configured → encrypt with the server env key. Env-key blobs are
 *   re-wrapped under the DEK on vault setup/unlock by
 *   migrateCredentialsToVault, and back to the env key on vault disable.
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

	return encrypt(JSON.stringify(creds));
}
