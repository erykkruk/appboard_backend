import { google } from "googleapis";
import { createLogger } from "@/utils/logger";

const log = createLogger("play-reports-storage");

export const STORAGE_READ_ONLY_SCOPE =
	"https://www.googleapis.com/auth/devstorage.read_only";
const STORAGE_API = "https://storage.googleapis.com/storage/v1/b";
const REQUEST_TIMEOUT_MS = 20_000;
const LIST_PAGE_SIZE = 1000;
/** A developer account with years of reports for many apps still fits in a few pages. */
const MAX_LIST_PAGES = 20;
const ERROR_BODY_PREVIEW = 300;

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

export type StorageFailureKind =
	| "access_denied"
	| "bucket_not_found"
	| "credentials_invalid"
	| "error";

export interface StorageFailure {
	detail: string;
	kind: StorageFailureKind;
	status: number | null;
}

export type StorageResult<T> =
	| { ok: true; value: T }
	| { failure: StorageFailure; ok: false };

export interface ServiceAccountKey {
	clientEmail: string;
	privateKey: string;
	privateKeyId?: string;
}

/**
 * Mint a Cloud Storage read-only token from the Play service account. The
 * same key the connection uses for the Publishing API: Play grants it the
 * bucket when the account has "View app information and download bulk
 * reports". Kept as a replaceable function so tests never reach Google.
 */
export type AccessTokenProvider = (
	key: ServiceAccountKey,
) => Promise<StorageResult<string>>;

export const googleAccessToken: AccessTokenProvider = async (key) => {
	try {
		const jwt = new google.auth.JWT({
			email: key.clientEmail,
			key: key.privateKey,
			keyId: key.privateKeyId,
			scopes: [STORAGE_READ_ONLY_SCOPE],
		});
		const { token } = await jwt.getAccessToken();
		if (!token) {
			return {
				failure: {
					detail: "Google returned no access token",
					kind: "credentials_invalid",
					status: null,
				},
				ok: false,
			};
		}
		return { ok: true, value: token };
	} catch (err) {
		log.warn({ err }, "Could not mint a Cloud Storage token");
		return {
			failure: {
				detail: err instanceof Error ? err.message : String(err),
				kind: "credentials_invalid",
				status: null,
			},
			ok: false,
		};
	}
};

function failureFromStatus(status: number, body: string): StorageFailure {
	const detail = body.slice(0, ERROR_BODY_PREVIEW);
	if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
		return { detail, kind: "access_denied", status };
	}
	if (status === HTTP_NOT_FOUND) {
		return { detail, kind: "bucket_not_found", status };
	}
	return { detail, kind: "error", status };
}

function networkFailure(err: unknown): StorageFailure {
	return {
		detail: err instanceof Error ? err.message : String(err),
		kind: "error",
		status: null,
	};
}

function bucketUrl(bucket: string): string {
	return `${STORAGE_API}/${encodeURIComponent(bucket)}/o`;
}

/**
 * Every object name under `prefix`. A 404 here means the bucket itself does
 * not exist (an empty prefix lists as zero items, not 404).
 */
export async function listObjects(
	bucket: string,
	prefix: string,
	token: string,
): Promise<StorageResult<string[]>> {
	const names: string[] = [];
	let pageToken: string | undefined;
	for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
		const params = new URLSearchParams({
			fields: "items(name),nextPageToken",
			maxResults: String(LIST_PAGE_SIZE),
			prefix,
		});
		if (pageToken) params.set("pageToken", pageToken);
		let response: Response;
		try {
			response = await fetch(`${bucketUrl(bucket)}?${params.toString()}`, {
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (err) {
			return { failure: networkFailure(err), ok: false };
		}
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			return { failure: failureFromStatus(response.status, body), ok: false };
		}
		const data = (await response.json().catch(() => ({}))) as {
			items?: Array<{ name?: string }>;
			nextPageToken?: string;
		};
		for (const item of data.items ?? []) {
			if (item.name) names.push(item.name);
		}
		pageToken = data.nextPageToken;
		if (!pageToken) break;
	}
	return { ok: true, value: names };
}

/** Raw bytes of one object; `null` when it does not exist (Play writes only what it has). */
export async function downloadObject(
	bucket: string,
	name: string,
	token: string,
): Promise<StorageResult<Uint8Array | null>> {
	let response: Response;
	try {
		response = await fetch(
			`${bucketUrl(bucket)}/${encodeURIComponent(name)}?alt=media`,
			{
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
	} catch (err) {
		return { failure: networkFailure(err), ok: false };
	}
	if (response.status === HTTP_NOT_FOUND) return { ok: true, value: null };
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		return { failure: failureFromStatus(response.status, body), ok: false };
	}
	return { ok: true, value: new Uint8Array(await response.arrayBuffer()) };
}
