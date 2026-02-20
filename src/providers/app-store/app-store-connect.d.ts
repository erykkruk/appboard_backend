declare module "node-app-store-connect-api" {
	interface ApiOptions {
		apiKey: string;
		issuerId: string;
		privateKey: string;
	}

	interface ApiResponse<T = unknown> {
		data: T[];
	}

	interface ApiClient {
		create(type: string, attributes: Record<string, unknown>, relationships?: Record<string, unknown>): Promise<ApiResponse>;
		modify(type: string, id: string, attributes: Record<string, unknown>): Promise<ApiResponse>;
		read(url: string, params?: Record<string, unknown>): Promise<ApiResponse>;
		readAll(type: string, params?: Record<string, unknown>): Promise<ApiResponse>;
		remove(type: string, id: string): Promise<void>;
	}

	export function api(options: ApiOptions): Promise<ApiClient>;
}
