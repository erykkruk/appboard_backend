import { api } from "node-app-store-connect-api";
import { createLogger } from "@/utils/logger";
import { createAscFetch } from "./asc-fetch";
import type { AppStoreCredentials } from "./types";

const log = createLogger("app-store-client");

export async function createAppStoreClient(credentials: AppStoreCredentials) {
	const { keyId, issuerId, privateKey } = credentials;
	if (!keyId || !issuerId || !privateKey) {
		throw new Error(
			"Missing App Store credentials (keyId, issuerId, privateKey)",
		);
	}

	log.info("Connecting to App Store Connect API...");
	const client = await api({
		apiKey: keyId,
		// Retries are handled by our fetch, which backs off instead of hammering.
		automaticRetries: 0,
		fetch: createAscFetch({ issuerId, keyId, privateKey }),
		issuerId,
		privateKey,
	});

	return client;
}
