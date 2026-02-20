import type { androidpublisher_v3 } from "googleapis";
import { google } from "googleapis";
import { createLogger } from "@/utils/logger";
import type { GooglePlayCredentials } from "./types";

const log = createLogger("google-play-client");

type AndroidPublisher = androidpublisher_v3.Androidpublisher;

export interface GooglePlayClient {
	api: AndroidPublisher;
	packageNames: string[];
}

/**
 * Creates an authenticated Google Play Developer API client
 * using service account credentials.
 */
export async function createGooglePlayClient(
	credentials: GooglePlayCredentials,
): Promise<GooglePlayClient> {
	const auth = new google.auth.GoogleAuth({
		credentials: {
			client_email: credentials.client_email,
			private_key: credentials.private_key,
			private_key_id: credentials.private_key_id,
		},
		projectId: credentials.project_id,
		scopes: ["https://www.googleapis.com/auth/androidpublisher"],
	});

	const api = google.androidpublisher({
		auth,
		version: "v3",
	});

	const packageNames = credentials.package_names ?? [];

	log.info(
		{
			clientEmail: credentials.client_email,
			packageCount: packageNames.length,
		},
		"Google Play API client created",
	);

	return { api, packageNames };
}

/**
 * Creates a new edit for the given package and returns the edit ID.
 * An edit is required for most listing/asset mutations.
 */
export async function createEdit(
	api: AndroidPublisher,
	packageName: string,
): Promise<string> {
	const { data } = await api.edits.insert({ packageName });
	const editId = data.id;
	if (!editId) {
		throw new Error(`Failed to create edit for package ${packageName}`);
	}
	log.info({ editId, packageName }, "Edit created");
	return editId;
}

/**
 * Commits (publishes) an existing edit.
 */
export async function commitEdit(
	api: AndroidPublisher,
	packageName: string,
	editId: string,
): Promise<void> {
	await api.edits.commit({ editId, packageName });
	log.info({ editId, packageName }, "Edit committed");
}

/**
 * Deletes (discards) an existing edit without committing.
 */
export async function deleteEdit(
	api: AndroidPublisher,
	packageName: string,
	editId: string,
): Promise<void> {
	try {
		await api.edits.delete({ editId, packageName });
		log.info({ editId, packageName }, "Edit discarded");
	} catch (err) {
		log.warn({ editId, err, packageName }, "Failed to discard edit");
	}
}
