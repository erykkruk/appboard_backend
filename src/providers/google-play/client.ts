import type { androidpublisher_v3 } from "googleapis";
import { google } from "googleapis";
import { createLogger } from "@/utils/logger";
import type { GooglePlayCredentials } from "./types";

const log = createLogger("google-play-client");

type AndroidPublisher = androidpublisher_v3.Androidpublisher;

export interface GooglePlayClient {
	api: AndroidPublisher;
	auth: InstanceType<typeof google.auth.GoogleAuth>;
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
		scopes: [
			"https://www.googleapis.com/auth/androidpublisher",
			"https://www.googleapis.com/auth/playdeveloperreporting",
		],
	});

	const api = google.androidpublisher({
		auth,
		version: "v3",
	});

	// Use explicitly provided package_names, or auto-discover via Reporting API
	let packageNames = credentials.package_names ?? [];

	if (packageNames.length === 0) {
		packageNames = await discoverPackageNames(auth);
	}

	log.info(
		{
			clientEmail: credentials.client_email,
			packageCount: packageNames.length,
		},
		"Google Play API client created",
	);

	return { api, auth, packageNames };
}

/**
 * Discovers all apps accessible by the service account using
 * the Play Developer Reporting API (supports draft & production apps).
 */
async function discoverPackageNames(
	auth: InstanceType<typeof google.auth.GoogleAuth>,
): Promise<string[]> {
	try {
		const reporting = google.playdeveloperreporting({
			auth,
			version: "v1beta1",
		});

		const names: string[] = [];
		let pageToken: string | undefined;
		do {
			const { data } = await reporting.apps.search({ pageToken });
			for (const app of data.apps ?? []) {
				if (app.packageName) names.push(app.packageName);
			}
			pageToken = data.nextPageToken ?? undefined;
		} while (pageToken);

		log.info(
			{ count: names.length, packages: names },
			"Auto-discovered apps via Reporting API",
		);
		return names;
	} catch (err) {
		log.warn({ err }, "Failed to discover apps via Reporting API");
		return [];
	}
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
 * Commits an existing edit.
 * By default, changes are NOT sent for review — they stay as a pending
 * update on Google Play until manually sent for review from the Console.
 * Set `sendForReview: true` to submit immediately.
 *
 * If `changesNotSentForReview` fails (e.g. new app without prior review),
 * automatically retries without the flag.
 */
export async function commitEdit(
	api: AndroidPublisher,
	packageName: string,
	editId: string,
	options?: { sendForReview?: boolean },
): Promise<void> {
	const wantDraft = !(options?.sendForReview ?? false);

	if (wantDraft) {
		try {
			await api.edits.commit({
				changesNotSentForReview: true,
				editId,
				packageName,
			});
			log.info(
				{ editId, packageName, sentForReview: false },
				"Edit committed (draft)",
			);
			return;
		} catch (err) {
			log.warn(
				{ editId, err: (err as Error).message, packageName },
				"Draft commit failed, retrying without changesNotSentForReview",
			);
		}
	}

	await api.edits.commit({
		editId,
		packageName,
	});
	log.info({ editId, packageName, sentForReview: true }, "Edit committed");
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
