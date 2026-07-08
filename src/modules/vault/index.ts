import { Elysia } from "elysia";
import { buildError } from "@/utils/errors";
import { checkRateLimit, rateLimitEnabled } from "@/utils/rate-limit";
import {
	vaultChangePassphraseBody,
	vaultSetupBody,
	vaultUnlockBody,
} from "./vault.schema";
import { VaultService } from "./vault.service";

// Brute-force brake: a wrong-passphrase loop hits this before the KDF cost
// becomes the only defence. Per workspace, sliding window.
const UNLOCK_MAX_ATTEMPTS = 5;
const UNLOCK_WINDOW_MS = 60_000;

export const vaultController = new Elysia({ prefix: "/vault" })
	.get("/status", ({ workspaceId }) => VaultService.status(workspaceId!), {
		detail: { description: "Vault existence + unlock state", tags: ["Vault"] },
	})
	.get("/params", ({ workspaceId }) => VaultService.getParams(workspaceId!), {
		detail: {
			description: "KDF params + wrapped DEK for client-side unlock",
			tags: ["Vault"],
		},
	})
	.post(
		"/setup",
		({ body, workspaceId }) => VaultService.setup(body, workspaceId!),
		{
			body: vaultSetupBody,
			detail: { description: "Create the workspace vault", tags: ["Vault"] },
		},
	)
	.post(
		"/unlock",
		({ body, workspaceId }) => {
			if (
				rateLimitEnabled() &&
				!checkRateLimit(
					`vault-unlock:${workspaceId}`,
					UNLOCK_MAX_ATTEMPTS,
					UNLOCK_WINDOW_MS,
				)
			) {
				buildError("rateLimitExceeded", {
					info: "Too many unlock attempts. Try again in a minute.",
				});
			}
			return VaultService.unlock(body, workspaceId!);
		},
		{
			body: vaultUnlockBody,
			detail: {
				description: "Unlock the vault for this session",
				tags: ["Vault"],
			},
		},
	)
	.post("/lock", ({ workspaceId }) => VaultService.lock(workspaceId!), {
		detail: {
			description: "Lock the vault (drop the in-memory key)",
			tags: ["Vault"],
		},
	})
	.post("/reset", ({ workspaceId }) => VaultService.reset(workspaceId!), {
		detail: {
			description: "Wipe the vault + encrypted credentials (unrecoverable)",
			tags: ["Vault"],
		},
	})
	.post(
		"/change-passphrase",
		({ body, workspaceId }) =>
			VaultService.changePassphrase(body, workspaceId!),
		{
			body: vaultChangePassphraseBody,
			detail: {
				description: "Re-wrap the DEK under a new passphrase",
				tags: ["Vault"],
			},
		},
	);
