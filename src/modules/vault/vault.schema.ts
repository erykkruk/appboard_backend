import { t } from "elysia";

const kdfParams = t.Object({
	algo: t.String({ minLength: 1 }),
	iterations: t.Number({ minimum: 1 }),
	memoryKiB: t.Number({ minimum: 1 }),
	parallelism: t.Number({ minimum: 1 }),
});

export const vaultSetupBody = t.Object({
	// raw DEK (base64) to unlock this session immediately after setup
	dek: t.String({ minLength: 1 }),
	kdfParams,
	kdfSalt: t.String({ minLength: 1 }),
	verifier: t.String({ minLength: 1 }),
	wrapNonce: t.String({ minLength: 1 }),
	wrappedDek: t.String({ minLength: 1 }),
});

export const vaultUnlockBody = t.Object({
	// unwrapped DEK (base64), derived + unwrapped in the browser
	dek: t.String({ minLength: 1 }),
});

export const vaultChangePassphraseBody = t.Object({
	kdfParams,
	kdfSalt: t.String({ minLength: 1 }),
	wrapNonce: t.String({ minLength: 1 }),
	wrappedDek: t.String({ minLength: 1 }),
});
