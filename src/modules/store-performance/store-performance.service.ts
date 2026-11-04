import { and, eq } from "drizzle-orm";
import { isPublicStore } from "@/modules/stores/provider-resolver";
import { decryptCredentials } from "@/modules/vault/credentials";
import { db } from "@/utils/db";
import { apps, stores } from "@/utils/db/schema";
import { buildError } from "@/utils/errors";
import { createLogger } from "@/utils/logger";
import {
	aggregateCountries,
	aggregateInstalls,
	aggregateTraffic,
	lastDay,
} from "./play-reports.aggregate";
import { normalizePlayReportsBucket } from "./play-reports.bucket";
import { parseReport } from "./play-reports.csv";
import {
	type AccessTokenProvider,
	downloadObject,
	googleAccessToken,
	listObjects,
	type StorageFailure,
} from "./play-reports.storage";
import type {
	MonthReport,
	StorePerformanceReport,
	StorePerformanceResponse,
	StorePerformanceStatus,
} from "./store-performance.types";

const log = createLogger("store-performance");

export const DEFAULT_REPORT_MONTHS = 3;
export const MAX_REPORT_MONTHS = 12;
/**
 * Play rewrites the monthly files at most once a day, so a report read
 * within the last hours is as fresh as the bucket. Cached in memory, not in
 * the DB: every number is re-derivable from the bucket in a few small reads,
 * a restart only costs one cold read, and nothing new has to be migrated.
 * Failures are never cached, so a permission fix shows up on the next try.
 */
export const REPORT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REPORT_CACHE_MAX_ENTRIES = 500;

const GOOGLE_PLAY_STORE_TYPE = "google_play";
const ANDROID_PLATFORM = "android";
const TV_DEVICE = "tv";

const trafficPrefix = (pkg: string) =>
	`stats/store_performance/store_performance_${pkg}_`;
const installsPrefix = (pkg: string) => `stats/installs/installs_${pkg}_`;
const trafficFile = (pkg: string, yyyymm: string) =>
	`${trafficPrefix(pkg)}${yyyymm}_traffic_source.csv`;
const countryFile = (pkg: string, yyyymm: string) =>
	`${trafficPrefix(pkg)}${yyyymm}_country.csv`;
const installsFile = (pkg: string, yyyymm: string) =>
	`${installsPrefix(pkg)}${yyyymm}_overview.csv`;

interface CacheEntry {
	expiresAt: number;
	fetchedAt: string;
	months: MonthReport[];
}

const reportCache = new Map<string, CacheEntry>();

function cacheKey(
	storeId: string,
	bucket: string,
	pkg: string,
	months: number,
): string {
	return JSON.stringify([storeId, bucket, pkg, months]);
}

function rememberReport(key: string, entry: CacheEntry): void {
	reportCache.delete(key);
	reportCache.set(key, entry);
	while (reportCache.size > REPORT_CACHE_MAX_ENTRIES) {
		const oldest = reportCache.keys().next().value;
		if (oldest === undefined) break;
		reportCache.delete(oldest);
	}
}

function forgetStore(storeId: string): void {
	for (const key of reportCache.keys()) {
		if ((JSON.parse(key) as string[])[0] === storeId) reportCache.delete(key);
	}
}

/** `count` calendar months ending with the one containing `now`, newest first, as YYYYMM. */
export function reportMonths(now: Date, count: number): string[] {
	const months: string[] = [];
	for (let offset = 0; offset < count; offset += 1) {
		const date = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
		);
		months.push(
			`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
		);
	}
	return months;
}

function displayMonth(yyyymm: string): string {
	return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}`;
}

export function clampMonths(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return DEFAULT_REPORT_MONTHS;
	}
	return Math.min(MAX_REPORT_MONTHS, Math.max(1, Math.trunc(value)));
}

/** What to tell the user for every non-"ok" state, including how to fix it. */
export function statusMessage(
	status: Exclude<StorePerformanceStatus, "ok">,
	context: {
		bucket: string | null;
		detail?: string;
		httpStatus?: number | null;
		serviceAccountEmail: string | null;
	},
): string {
	const account =
		context.serviceAccountEmail ?? "the service account of this connection";
	switch (status) {
		case "bucket_missing":
			return 'Add the Play reports bucket to this Google Play connection (Settings > Connected Stores > Play reports bucket). In Play Console open Download reports > Statistics and press "Copy Cloud Storage URI"; it starts with gs://pubsite_prod_.';
		case "integration_required":
			return "This app was added from a public store link. Store performance reads the Play Console bulk reports, which needs a Google Play API connection (service account key).";
		case "access_denied":
			return `${account} cannot read the Play reports bucket ${context.bucket ?? ""} (HTTP ${context.httpStatus ?? 403}). In Play Console open Users and permissions, open ${account}, and under Account permissions turn on "View app information and download bulk reports (read-only)", then save. Google can take a while to open the bucket after the change; try again later.`;
		case "bucket_not_found":
			return `The bucket ${context.bucket ?? ""} does not exist. Copy the Cloud Storage URI again from Play Console > Download reports > Statistics (it starts with gs://pubsite_prod_) and save it on the Google Play connection.`;
		case "credentials_invalid":
			return `Google did not accept the service account key of this connection${context.detail ? ` (${context.detail})` : ""}. Reconnect the Google Play store with a valid JSON key.`;
		case "error":
			return `Google Cloud Storage did not answer${context.httpStatus ? ` (HTTP ${context.httpStatus})` : ""}${context.detail ? `: ${context.detail}` : ""}. Try again later.`;
	}
}

interface ReportTarget {
	bucket: string;
	packageName: string;
	serviceAccount: {
		clientEmail: string;
		privateKey: string;
		privateKeyId?: string;
	};
}

type FetchOutcome =
	| { months: MonthReport[]; ok: true }
	| { failure: StorageFailure; ok: false };

export class StorePerformanceService {
	/** Test seam: replaced in tests so no request reaches Google's token endpoint. */
	static accessToken: AccessTokenProvider = googleAccessToken;
	/** Test seam for the month window. */
	static now: () => Date = () => new Date();

	static clearCache(): void {
		reportCache.clear();
	}

	static async report(
		appId: string,
		workspaceId: string,
		options: { months?: number; refresh?: boolean } = {},
	): Promise<StorePerformanceResponse> {
		const [row] = await db
			.select({
				connectionMode: stores.connectionMode,
				credentials: stores.credentials,
				devices: apps.devices,
				externalId: apps.externalId,
				platform: apps.platform,
				playReportsBucket: stores.playReportsBucket,
				storeId: stores.id,
				storeType: stores.type,
			})
			.from(apps)
			.innerJoin(stores, eq(apps.storeId, stores.id))
			.where(and(eq(apps.id, appId), eq(stores.workspaceId, workspaceId)))
			.limit(1);
		if (!row) buildError("notFound", { info: "App not found" });

		if (row.platform !== ANDROID_PLATFORM) {
			return {
				message:
					"App Store analytics (impressions, product page views, sources) are coming later. Store performance covers Google Play apps for now.",
				platform: row.platform,
				supported: false,
			};
		}
		if (row.storeType !== GOOGLE_PLAY_STORE_TYPE) {
			return {
				message:
					"Store performance reads the Google Play Console bulk reports. Other Android stores are not covered.",
				platform: row.platform,
				supported: false,
			};
		}

		const devices = row.devices ?? [];
		const base: StorePerformanceReport = {
			bucket: row.playReportsBucket,
			devices,
			fetchedAt: null,
			message: null,
			months: [],
			packageName: row.externalId,
			serviceAccountEmail: null,
			status: "ok",
			storeId: row.storeId,
			supported: true,
			tvOnly: devices.includes(TV_DEVICE) && !devices.includes("phone"),
		};
		const withStatus = (
			status: Exclude<StorePerformanceStatus, "ok">,
			failure?: StorageFailure,
		): StorePerformanceReport => ({
			...base,
			message: statusMessage(status, {
				bucket: base.bucket,
				detail: failure?.detail,
				httpStatus: failure?.status,
				serviceAccountEmail: base.serviceAccountEmail,
			}),
			status,
		});

		if (isPublicStore(row) || !row.credentials) {
			return withStatus("integration_required");
		}
		const credentials = decryptCredentials(row.credentials, workspaceId);
		const clientEmail =
			typeof credentials.client_email === "string"
				? credentials.client_email
				: "";
		const privateKey =
			typeof credentials.private_key === "string"
				? credentials.private_key
				: "";
		if (credentials.mock === true || !clientEmail || !privateKey) {
			return withStatus("integration_required");
		}
		base.serviceAccountEmail = clientEmail;
		if (!row.playReportsBucket) return withStatus("bucket_missing");

		const months = clampMonths(options.months);
		const key = cacheKey(
			row.storeId,
			row.playReportsBucket,
			row.externalId,
			months,
		);
		if (options.refresh) {
			reportCache.delete(key);
		} else {
			const cached = reportCache.get(key);
			if (cached && cached.expiresAt > Date.now()) {
				return { ...base, fetchedAt: cached.fetchedAt, months: cached.months };
			}
		}

		const outcome = await StorePerformanceService.fetchMonths(
			{
				bucket: row.playReportsBucket,
				packageName: row.externalId,
				serviceAccount: {
					clientEmail,
					privateKey,
					privateKeyId:
						typeof credentials.private_key_id === "string"
							? credentials.private_key_id
							: undefined,
				},
			},
			reportMonths(StorePerformanceService.now(), months),
		);
		if (!outcome.ok) {
			log.warn(
				{
					httpStatus: outcome.failure.status,
					kind: outcome.failure.kind,
					storeId: row.storeId,
				},
				"Play reports bucket read failed",
			);
			return withStatus(outcome.failure.kind, outcome.failure);
		}

		const fetchedAt = new Date().toISOString();
		rememberReport(key, {
			expiresAt: Date.now() + REPORT_CACHE_TTL_MS,
			fetchedAt,
			months: outcome.months,
		});
		return { ...base, fetchedAt, months: outcome.months };
	}

	private static async fetchMonths(
		target: ReportTarget,
		months: string[],
	): Promise<FetchOutcome> {
		const token = await StorePerformanceService.accessToken(
			target.serviceAccount,
		);
		if (!token.ok) return token;

		const { bucket, packageName } = target;
		// Listing first: one call tells which files exist, and a missing bucket
		// or missing permission surfaces here instead of as a wall of 404s.
		const [trafficNames, installNames] = await Promise.all([
			listObjects(bucket, trafficPrefix(packageName), token.value),
			listObjects(bucket, installsPrefix(packageName), token.value),
		]);
		if (!trafficNames.ok) return trafficNames;
		if (!installNames.ok) return installNames;
		const available = new Set([...trafficNames.value, ...installNames.value]);

		const read = async (name: string) =>
			available.has(name)
				? downloadObject(bucket, name, token.value)
				: ({ ok: true, value: null } as const);

		const reports: MonthReport[] = [];
		for (const yyyymm of months) {
			const [traffic, country, installs] = await Promise.all([
				read(trafficFile(packageName, yyyymm)),
				read(countryFile(packageName, yyyymm)),
				read(installsFile(packageName, yyyymm)),
			]);
			if (!traffic.ok) return traffic;
			if (!country.ok) return country;
			if (!installs.ok) return installs;

			const trafficRecords = traffic.value ? parseReport(traffic.value) : null;
			const countryRecords = country.value ? parseReport(country.value) : null;
			const installRecords = installs.value
				? parseReport(installs.value)
				: null;
			reports.push({
				countries: countryRecords ? aggregateCountries(countryRecords) : null,
				files: {
					country: countryRecords !== null,
					installs: installRecords !== null,
					trafficSource: trafficRecords !== null,
				},
				installs: installRecords ? aggregateInstalls(installRecords) : null,
				lastDay: trafficRecords ? lastDay(trafficRecords) : null,
				month: displayMonth(yyyymm),
				traffic: trafficRecords ? aggregateTraffic(trafficRecords) : null,
			});
		}
		return { months: reports, ok: true };
	}

	/**
	 * Save (or clear with null / "") the bulk-report bucket of a Google Play
	 * connection. Returns the normalized bucket name.
	 */
	static async setBucket(
		storeId: string,
		workspaceId: string,
		input: string | null,
	): Promise<{ playReportsBucket: string | null }> {
		const [store] = await db
			.select({ type: stores.type })
			.from(stores)
			.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)))
			.limit(1);
		if (!store) buildError("notFound", { info: "Store not found" });
		if (store.type !== GOOGLE_PLAY_STORE_TYPE) {
			buildError("badRequest", {
				info: "Only Google Play connections have a Play reports bucket.",
			});
		}

		const trimmed = input?.trim() ?? "";
		const bucket = trimmed ? normalizePlayReportsBucket(trimmed) : null;
		if (trimmed && !bucket) {
			buildError("badRequest", {
				info: "That is not a Cloud Storage bucket. Paste the URI from Play Console > Download reports > Statistics > Copy Cloud Storage URI, e.g. gs://pubsite_prod_1234567890.",
			});
		}

		await db
			.update(stores)
			.set({ playReportsBucket: bucket })
			.where(and(eq(stores.id, storeId), eq(stores.workspaceId, workspaceId)));
		forgetStore(storeId);
		log.info(
			{ cleared: bucket === null, storeId },
			"Play reports bucket saved",
		);
		return { playReportsBucket: bucket };
	}
}
