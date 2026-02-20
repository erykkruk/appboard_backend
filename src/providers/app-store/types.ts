export interface AppStoreCredentials {
	issuerId?: string;
	keyId?: string;
	mock?: boolean;
	privateKey?: string;
}

export function isMockCredentials(creds: AppStoreCredentials): boolean {
	return creds.mock === true;
}
