import { api } from "node-app-store-connect-api";
import { createLogger } from "@/utils/logger";
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
		issuerId,
		privateKey,
	});

	return client;
}
