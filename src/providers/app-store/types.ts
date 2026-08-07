export interface AppStoreCredentials {
	issuerId?: string;
	keyId?: string;
	mock?: boolean;
	privateKey?: string;
}

/** Credentials after the presence check in `createAppStoreClient`. */
export interface AppStoreApiCredentials {
	issuerId: string;
	keyId: string;
	privateKey: string;
}

export function isMockCredentials(creds: AppStoreCredentials): boolean {
	return creds.mock === true;
}
