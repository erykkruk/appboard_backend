import { createHash } from "node:crypto";
import type {
	ApiClient,
	ApiResourceWithLinks,
} from "node-app-store-connect-api";
import {
	computeBackoffMs,
	isRetryableStatus,
	nextDelayMs,
	sleep,
} from "@/utils/backoff";
import { createLogger } from "@/utils/logger";

const log = createLogger("app-store-upload");

const MAX_ATTEMPTS_PER_PART = 5;

/** ~60s of processing, matching the library's old default. */
const DELIVERY_POLL_MAX_ATTEMPTS = 60;
const DELIVERY_POLL_INTERVAL_MS = 1_000;
const DELIVERY_POLL_MAX_READ_FAILURES = 3;

interface DeliveryState {
	errors?: Array<{ code?: string; description?: string }>;
	state?: string;
}

interface UploadOperation {
	length: number;
	method: string;
	offset: number;
	requestHeaders: Array<{ name: string; value: string }>;
	url: string;
}

/**
 * Uploads the bytes of a reserved App Store Connect asset (screenshot, preview
 * or review attachment) and commits the reservation.
 *
 * Replaces the library's `uploadAsset()` for three reasons:
 *
 * 1. It commits with `sourceFileChecksum` (MD5 of the source file), which is how
 *    Apple verifies the delivered bytes — the library sends only
 *    `{ uploaded: true }`, so a corrupted upload could only be caught later via
 *    `assetDeliveryState`. It also gives us a checksum to dedupe against.
 * 2. Parts go sequentially with real backoff instead of a parallel, delay-free
 *    retry loop.
 * 3. A failed upload deletes the reservation instead of leaving an orphaned,
 *    never-committed asset row on Apple's side.
 *
 * The upload URLs are pre-signed and time-limited; per Apple's docs they must
 * NOT carry the JWT.
 */
export interface UploadPollOptions {
	intervalMs?: number;
	maxAttempts?: number;
}

export async function uploadAndCommitAsset(
	client: ApiClient,
	reservation: ApiResourceWithLinks,
	buffer: Buffer,
	label = "asset",
	pollOptions: UploadPollOptions = {},
): Promise<{ sourceFileChecksum: string }> {
	const operations = reservation.attributes?.uploadOperations as
		| UploadOperation[]
		| undefined;

	if (!operations?.length) {
		throw new Error(
			`${label} reservation ${reservation.type}/${reservation.id} has no uploadOperations`,
		);
	}

	const sourceFileChecksum = md5(buffer);

	try {
		for (const [index, operation] of operations.entries()) {
			await uploadPart(
				operation,
				buffer,
				`${label} part ${index + 1}/${operations.length}`,
			);
		}

		await client.update(reservation, {
			attributes: { sourceFileChecksum, uploaded: true },
		});
	} catch (err) {
		await discardReservation(client, reservation, label);
		throw err;
	}

	await waitForDelivery(client, reservation, label, pollOptions);

	return { sourceFileChecksum };
}

export function md5(buffer: Buffer): string {
	return createHash("md5").update(buffer).digest("hex");
}

/**
 * Waits for Apple to finish processing the delivered bytes.
 *
 * Only `FAILED` means the asset is garbage and must be removed. A slow queue or
 * a hiccup on the read-back does NOT — deleting there would destroy a
 * successfully uploaded screenshot, which is strictly worse than leaving one
 * that is still processing. So a timeout is a warning, not an error: the bytes
 * are committed and Apple will finish on its own.
 */
async function waitForDelivery(
	client: ApiClient,
	reservation: ApiResourceWithLinks,
	label: string,
	{
		intervalMs = DELIVERY_POLL_INTERVAL_MS,
		maxAttempts = DELIVERY_POLL_MAX_ATTEMPTS,
	}: UploadPollOptions,
): Promise<void> {
	const selfUrl =
		reservation.links?.self ?? `${reservation.type}/${reservation.id}`;

	let readFailures = 0;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		let state: string | undefined;

		try {
			const asset = (await client.fetchJson(selfUrl)) as
				| { attributes?: { assetDeliveryState?: DeliveryState } }
				| undefined;
			const delivery = asset?.attributes?.assetDeliveryState;
			state = delivery?.state;

			if (state === "COMPLETE") return;

			if (state === "FAILED") {
				await discardReservation(client, reservation, label);
				throw new Error(
					`${label} was rejected by Apple: ${JSON.stringify(delivery?.errors ?? [])}`,
				);
			}

			readFailures = 0;
		} catch (err) {
			if (err instanceof Error && err.message.includes("rejected by Apple")) {
				throw err;
			}

			readFailures++;
			if (readFailures >= DELIVERY_POLL_MAX_READ_FAILURES) {
				log.warn(
					{ err, id: reservation.id, label },
					"Could not read asset delivery state; leaving the uploaded asset in place",
				);
				return;
			}
		}

		await sleep(intervalMs);
	}

	log.warn(
		{ id: reservation.id, label },
		"Asset still processing after the poll window; leaving it in place",
	);
}

async function uploadPart(
	operation: UploadOperation,
	buffer: Buffer,
	label: string,
): Promise<void> {
	const body = buffer.subarray(
		operation.offset,
		operation.offset + operation.length,
	);

	const headers = new Headers();
	for (const header of operation.requestHeaders ?? []) {
		headers.set(header.name, header.value);
	}

	for (let attempt = 1; ; attempt++) {
		let response: Response;
		try {
			response = await fetch(operation.url, {
				body: body as unknown as BodyInit,
				headers,
				method: operation.method,
			});
		} catch (err) {
			if (attempt >= MAX_ATTEMPTS_PER_PART) throw err;
			await sleep(computeBackoffMs(attempt));
			continue;
		}

		if (response.ok) return;

		const retryable = isRetryableStatus(response.status);
		if (!retryable || attempt >= MAX_ATTEMPTS_PER_PART) {
			throw new Error(
				`Failed uploading ${label}: ${response.status} ${response.statusText} ${await response.text()}`,
			);
		}

		const delay = nextDelayMs(attempt, response.headers.get("retry-after"));
		log.warn(
			{ attempt, delay, label, status: response.status },
			"Upload part failed, retrying",
		);
		await sleep(delay);
	}
}

async function discardReservation(
	client: ApiClient,
	reservation: ApiResourceWithLinks,
	label: string,
): Promise<void> {
	try {
		await client.remove({ id: reservation.id, type: reservation.type });
		log.info(
			{ id: reservation.id, label },
			"Discarded failed asset reservation",
		);
	} catch (err) {
		log.warn(
			{ err, id: reservation.id, label },
			"Failed to discard asset reservation",
		);
	}
}
