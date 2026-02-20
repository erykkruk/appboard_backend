declare module "node-app-store-connect-api" {
	interface ApiOptions {
		apiKey: string;
		issuerId: string;
		privateKey: string;
	}

	interface ApiResource {
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

	interface ReadResponse {
		data: ApiResource[];
		included?: Record<string, Record<string, ApiResource>>;
		links?: Record<string, string>;
		meta?: Record<string, unknown>;
	}

	interface ReadAllResponse {
		data: ApiResource[];
		included?: Record<string, Record<string, ApiResource>>;
	}

	interface CreateOptions {
		attributes?: Record<string, unknown>;
		included?: Array<Record<string, unknown>>;
		relationships?: Record<string, unknown>;
		type: string;
		version?: number;
	}

	interface UpdateOptions {
		attributes?: Record<string, unknown>;
		included?: Array<Record<string, unknown>>;
		relationships?: Record<string, unknown>;
		version?: number;
	}

	interface ApiResourceWithLinks extends ApiResource {
		links?: Record<string, string>;
	}

	interface CreateResponse {
		data: ApiResourceWithLinks;
	}

	interface ApiClient {
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
