export interface GooglePlayCredentials {
	client_email?: string;
	mock?: boolean;
	private_key?: string;
	type?: string;
}

export function isMockCredentials(creds: GooglePlayCredentials): boolean {
	return creds.type === "mock" || creds.mock === true;
}
