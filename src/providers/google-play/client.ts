import type { androidpublisher_v3 } from "googleapis";
import { google } from "googleapis";
import { createLogger } from "@/utils/logger";
import type { GooglePlayCredentials } from "./types";

const log = createLogger("google-play-client");

type AndroidPublisher = androidpublisher_v3.Androidpublisher;

/**
 * googleapis does not retry by default. Play throttles per-minute and returns
 * transient 5xx during edit commits, so we let gaxios back off for us.
 */
const PLAY_MAX_RETRIES = 5;
const PLAY_RETRY_BASE_DELAY_MS = 1_000;

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
		retry: true,
		retryConfig: {
			// Only replayable verbs — a retried POST could double-commit an edit
			// or duplicate an image upload.
			httpMethodsToRetry: ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"],
			noResponseRetries: 2,
			retry: PLAY_MAX_RETRIES,
			retryDelay: PLAY_RETRY_BASE_DELAY_MS,
			statusCodesToRetry: [
				[429, 429],
				[500, 504],
			],
		},
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
 * Google flips the `changesNotSentForReview` requirement depending on the app
 * and the change type, and tells us which way in the error body. fastlane
 * (supply `rescue_changes_not_sent_for_review`) keys off these exact messages;
 * so do we.
 */
const MUST_NOT_SET_CHANGES_NOT_SENT =
	/changesNotSentForReview must not be set/i;
const MUST_SET_CHANGES_NOT_SENT =
	/set the query parameter changesNotSentForReview to true/i;

function errorText(err: unknown): string {
	const gaxios = err as { message?: string; response?: { data?: unknown } };
	const body = gaxios.response?.data
		? JSON.stringify(gaxios.response.data)
		: "";
	return `${gaxios.message ?? String(err)} ${body}`;
}

/**
 * Commits an existing edit.
 *
 * By default changes are NOT sent for review — they stay as a pending update on
 * Google Play until sent for review explicitly. Pass `sendForReview: true` to
 * submit immediately.
 *
 * A rejected commit does not consume the edit, so the message-driven retries
 * below reuse the same edit ID (as supply does). We only flip the review
 * behaviour when Google explicitly demands it — the previous code retried on
 * *any* error and silently sent the changes for review.
 */
export async function commitEdit(
	api: AndroidPublisher,
	packageName: string,
	editId: string,
	options?: { sendForReview?: boolean },
): Promise<void> {
	const sendForReview = options?.sendForReview ?? false;
	const changesNotSentForReview = !sendForReview;

	try {
		await api.edits.commit({
			changesNotSentForReview,
			editId,
			packageName,
		});
		log.info(
			{ editId, packageName, sentForReview: sendForReview },
			"Edit committed",
		);
		return;
	} catch (err) {
		const message = errorText(err);

		if (MUST_NOT_SET_CHANGES_NOT_SENT.test(message)) {
			await api.edits.commit({ editId, packageName });
			log.info(
				{ editId, packageName },
				"Edit committed without changesNotSentForReview (Google rejected the flag)",
			);
			return;
		}

		if (MUST_SET_CHANGES_NOT_SENT.test(message)) {
			await api.edits.commit({
				changesNotSentForReview: true,
				editId,
				packageName,
			});
			log.info(
				{ editId, packageName },
				"Edit committed as draft (Google required changesNotSentForReview)",
			);
			return;
		}

		log.error({ editId, err, packageName }, "Edit commit failed");
		throw err;
	}
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
