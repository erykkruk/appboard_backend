import { eq } from "drizzle-orm";
import { decrypt, decryptWithKey, encryptWithKey } from "@/utils/crypto";
import { db } from "@/utils/db";
import { stores, workspaceVault } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import { VAULT_PREFIX } from "./credentials";
import { vaultSession } from "./vault.session";

const log = createLogger("vault");

/** Known constant encrypted under the DEK — proves a correct unlock. */
const VERIFIER_PLAINTEXT = "appboard-vault-v1";

interface KdfParams {
	algo: string;
	iterations: number;
	memoryKiB: number;
	parallelism: number;
}

interface SetupInput {
	dek: string;
	kdfParams: KdfParams;
	kdfSalt: string;
	verifier: string;
	wrappedDek: string;
	wrapNonce: string;
}

interface ChangePassphraseInput {
	kdfParams: KdfParams;
	kdfSalt: string;
	wrappedDek: string;
	wrapNonce: string;
}

function decodeDek(b64: string): Buffer {
	const dek = Buffer.from(b64, "base64");
	if (dek.length !== 32) {
		buildError("badRequest", {
			info: "Invalid key length (expected 32 bytes)",
		});
	}
	return dek;
}

function verifierMatches(dek: Buffer, verifier: string): boolean {
	try {
		return decryptWithKey(dek, verifier) === VERIFIER_PLAINTEXT;
	} catch {
		return false;
	}
}

export const VaultService = {
	/**
	 * Up-front gate for store actions: require an unlocked vault before running.
	 *
	 * - Unlocked → proceed.
	 * - Configured but locked → 423 (unlock first).
	 * - Not configured → proceed and let the credential layer decide (connect
	 *   raises 428 VAULT_REQUIRED via `encryptCredentials`; read-only actions on
	 *   apps that never stored credentials are unaffected).
	 */
	async assertUnlockedForAction(workspaceId: string): Promise<void> {
		if (vaultSession.isUnlocked(workspaceId)) return;

		const [vault] = await db
			.select({ id: workspaceVault.id })
			.from(workspaceVault)
			.where(eq(workspaceVault.workspaceId, workspaceId))
			.limit(1);
		if (vault) {
			buildError("vaultLocked", {
				info: "Vault is locked. Unlock it with your passphrase to perform actions on your stores.",
			});
		}
	},

	/** Re-wrap the SAME DEK under a new passphrase-derived KEK (done in browser). */
	async changePassphrase(input: ChangePassphraseInput, workspaceId: string) {
		const [vault] = await db
			.select({ id: workspaceVault.id })
			.from(workspaceVault)
			.where(eq(workspaceVault.workspaceId, workspaceId))
			.limit(1);
		if (!vault) buildError("notFound", { info: "No vault configured" });

		await db
			.update(workspaceVault)
			.set({
				kdfParams: input.kdfParams,
				kdfSalt: input.kdfSalt,
				wrapNonce: input.wrapNonce,
				wrappedDek: input.wrappedDek,
			})
			.where(eq(workspaceVault.workspaceId, workspaceId));
		return { changed: true };
	},

	/** Public KDF material so the browser can derive the KEK and unwrap the DEK. */
	async getParams(workspaceId: string) {
		const [vault] = await db
			.select()
			.from(workspaceVault)
			.where(eq(workspaceVault.workspaceId, workspaceId))
			.limit(1);
		if (!vault) {
			buildError("notFound", {
				info: "No vault configured for this workspace",
			});
		}
		return {
			kdfParams: vault.kdfParams,
			kdfSalt: vault.kdfSalt,
			wrapNonce: vault.wrapNonce,
			wrappedDek: vault.wrappedDek,
		};
	},

	lock(workspaceId: string) {
		vaultSession.lock(workspaceId);
		return { locked: true };
	},

	/** Re-encrypt any legacy (env-key) store credentials under the vault DEK. */
	async migrateCredentialsToVault(workspaceId: string, dek: Buffer) {
		const rows = await db
			.select({ credentials: stores.credentials, id: stores.id })
			.from(stores)
			.where(eq(stores.workspaceId, workspaceId));

		let migrated = 0;
		for (const row of rows) {
			if (!row.credentials || row.credentials.startsWith(VAULT_PREFIX))
				continue;
			try {
				const plain = decrypt(row.credentials);
				const reEncrypted = VAULT_PREFIX + encryptWithKey(dek, plain);
				await db
					.update(stores)
					.set({ credentials: reEncrypted })
					.where(eq(stores.id, row.id));
				migrated++;
			} catch (err) {
				log.error(
					{ err, storeId: row.id },
					"Failed to migrate credentials to vault",
				);
			}
		}
		return migrated;
	},

	/**
	 * Reset: wipe the vault and all credentials encrypted under it. They are
	 * unrecoverable without the passphrase, so the user re-uploads fresh
	 * credentials afterwards. Stores are marked disconnected.
	 */
	async reset(workspaceId: string) {
		await db
			.update(stores)
			.set({ credentials: null, status: "disconnected" })
			.where(eq(stores.workspaceId, workspaceId));
		await db
			.delete(workspaceVault)
			.where(eq(workspaceVault.workspaceId, workspaceId));
		vaultSession.lock(workspaceId);
		log.warn({ workspaceId }, "Vault reset — encrypted credentials wiped");
		return { reset: true };
	},

	async setup(input: SetupInput, workspaceId: string) {
		const [existing] = await db
			.select({ id: workspaceVault.id })
			.from(workspaceVault)
			.where(eq(workspaceVault.workspaceId, workspaceId))
			.limit(1);
		if (existing) {
			buildError("badRequest", {
				info: "Vault already configured. Reset it first to start over.",
			});
		}

		const dek = decodeDek(input.dek);
		if (!verifierMatches(dek, input.verifier)) {
			buildError("badRequest", {
				info: "Vault verifier does not match the key",
			});
		}

		await db.insert(workspaceVault).values({
			kdfParams: input.kdfParams,
			kdfSalt: input.kdfSalt,
			verifier: input.verifier,
			workspaceId,
			wrapNonce: input.wrapNonce,
			wrappedDek: input.wrappedDek,
		});

		vaultSession.unlock(workspaceId, dek);
		const migrated = await this.migrateCredentialsToVault(workspaceId, dek);
		log.info({ migrated, workspaceId }, "Vault created");
		return { migrated };
	},

	async status(workspaceId: string) {
		const [vault] = await db
			.select({ id: workspaceVault.id })
			.from(workspaceVault)
			.where(eq(workspaceVault.workspaceId, workspaceId))
			.limit(1);
		return { exists: !!vault, unlocked: vaultSession.isUnlocked(workspaceId) };
	},

	async unlock(input: { dek: string }, workspaceId: string) {
		const [vault] = await db
			.select({ verifier: workspaceVault.verifier })
			.from(workspaceVault)
			.where(eq(workspaceVault.workspaceId, workspaceId))
			.limit(1);
		if (!vault) buildError("notFound", { info: "No vault configured" });

		const dek = decodeDek(input.dek);
		if (!verifierMatches(dek, vault.verifier)) {
			buildError("unauthorized", { info: "Incorrect vault passphrase" });
		}

		vaultSession.unlock(workspaceId, dek);
		// Safety net: re-wrap any credential blob still on the legacy env key
		// (e.g. from a partially failed migration at setup time).
		const migrated = await this.migrateCredentialsToVault(workspaceId, dek);
		if (migrated > 0) {
			log.info(
				{ migrated, workspaceId },
				"Migrated legacy credentials on unlock",
			);
		}
		return { unlocked: true };
	},
};
