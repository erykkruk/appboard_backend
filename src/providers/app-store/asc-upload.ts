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
export async function uploadAndCommitAsset(
	client: ApiClient,
	reservation: ApiResourceWithLinks,
	buffer: Buffer,
	label = "asset",
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

	const selfUrl =
		reservation.links?.self ?? `${reservation.type}/${reservation.id}`;
	try {
		await client.pollForUploadSuccess(selfUrl, label);
	} catch (err) {
		// Apple rejected the delivered bytes (or never finished processing them):
		// the asset row is useless, so don't leave it behind in the set.
		await discardReservation(client, reservation, label);
		throw err;
	}

	return { sourceFileChecksum };
}

export function md5(buffer: Buffer): string {
	return createHash("md5").update(buffer).digest("hex");
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
