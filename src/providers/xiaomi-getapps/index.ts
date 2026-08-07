import { createPrivateKey } from "node:crypto";
import { AlternativeStoreProvider } from "@/providers/alternative/base";
import type { AppData } from "@/providers/store-provider";
import { createLogger } from "@/utils/logger";

const log = createLogger("xiaomi-provider");

/** Credentials pasted in the panel: Xiaomi Developer Console → API key. */
export interface XiaomiCredentials {
	email: string;
	/** PEM-encoded RSA private key issued with the developer account. */
	privateKey: string;
}

/**
 * Xiaomi GetApps provider.
 *
 * Xiaomi's developer "push" API is documented only as an APK publishing
 * endpoint, with no public specification for reading or editing store listing
 * metadata. Rather than guess at endpoint paths and field names, this provider
 * verifies the key material locally and leaves every store operation
 * console-only, raising a typed error that says so.
 */
export class XiaomiGetAppsProvider extends AlternativeStoreProvider {
	private readonly credentials: XiaomiCredentials;

	constructor(credentials: Record<string, unknown>) {
		super("xiaomi_getapps");
		this.credentials = credentials as unknown as XiaomiCredentials;
	}

	/**
	 * There is no documented endpoint to call, so this checks what can be
	 * checked: that the private key actually parses. Anything else would be a
	 * fake success.
	 */
	async validateCredentials(): Promise<{ reason?: string; valid: boolean }> {
		if (!this.credentials.email?.includes("@")) {
			return {
				reason: "The developer account email is missing or malformed.",
				valid: false,
			};
		}

		try {
			createPrivateKey(this.credentials.privateKey);
		} catch {
			return {
				reason:
					"The private key could not be parsed. Paste the PEM key exactly as downloaded from the Xiaomi Developer Console.",
				valid: false,
			};
		}

		log.info(
			{ email: this.credentials.email },
			"Xiaomi GetApps credentials stored (no listing API available)",
		);
		return { valid: true };
	}

	/** Xiaomi exposes no endpoint that enumerates a developer's apps. */
	async fetchApps(): Promise<AppData[]> {
		log.info("Xiaomi GetApps has no app list API — manage apps in the console");
		return [];
	}
}
