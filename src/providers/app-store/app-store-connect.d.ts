declare module "node-app-store-connect-api" {
	export interface ApiOptions {
		apiKey: string;
		/** Blind, delay-free retries inside the library. Set to 0 — we retry in `fetch`. */
		automaticRetries?: number;
		fetch?: (url: string, options?: RequestInit) => Promise<Response>;
		issuerId: string;
		privateKey: string;
	}

	export interface ApiResource {
		attributes: Record<string, unknown>;
		id: string;
		relationships?: Record<
			string,
			{
				data:
					| { id: string; type: string }
					| Array<{ id: string; type: string }>;
				links?: { related: string; self: string };
			}
		>;
		type: string;
	}

	export interface ReadResponse {
		data: ApiResource[];
		included?: Record<string, Record<string, ApiResource>>;
		links?: Record<string, string>;
		meta?: Record<string, unknown>;
	}

	export interface ReadAllResponse {
		data: ApiResource[];
		included?: Record<string, Record<string, ApiResource>>;
	}

	export interface CreateOptions {
		attributes?: Record<string, unknown>;
		included?: Array<Record<string, unknown>>;
		relationships?: Record<string, unknown>;
		type: string;
		version?: number;
	}

	export interface UpdateOptions {
		attributes?: Record<string, unknown>;
		included?: Array<Record<string, unknown>>;
		relationships?: Record<string, unknown>;
		version?: number;
	}

	export interface ApiResourceWithLinks extends ApiResource {
		links?: Record<string, string>;
	}

	/**
	 * `create()` resolves to the resource itself — the library unwraps the
	 * JSON:API `{ data }` envelope for us. Typing it as `{ data: ... }` is what
	 * let a `created.data` dereference (always undefined) ship undetected.
	 */
	export type CreateResponse = ApiResourceWithLinks;

	export interface ApiClient {
		create(options: CreateOptions): Promise<CreateResponse>;
		read(url: string, options?: Record<string, unknown>): Promise<ReadResponse>;
		readAll(
			url: string,
			options?: Record<string, unknown>,
		): Promise<ReadAllResponse>;
		remove(
			data: { id: string; type: string },
			options?: Record<string, unknown>,
		): Promise<void>;
		update(
			data: { id: string; type: string },
			options: UpdateOptions,
		): Promise<ApiResource>;
		fetchJson(url: string, options?: Record<string, unknown>): Promise<unknown>;
		postJson(
			url: string,
			data: unknown,
			options?: Record<string, unknown>,
		): Promise<unknown>;
		uploadAsset(
			assetData: CreateResponse,
			buffer: Buffer,
			maxTriesPerPart?: number,
			version?: number,
		): Promise<void>;
		pollForUploadSuccess(
			assetUrl: string,
			logHeader?: string,
			delayInMilliseconds?: number,
			maxTries?: number,
		): Promise<void>;
	}

	export function api(options: ApiOptions): Promise<ApiClient>;
}
