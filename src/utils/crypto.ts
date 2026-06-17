import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import config from "@/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/**
 * AES-256-GCM encrypt with an explicit 32-byte key. Output: `iv:authTag:data`
 * (all hex). Used both for the env-key path and the per-workspace vault DEK.
 */
export function encryptWithKey(key: Buffer, plaintext: string): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptWithKey(key: Buffer, ciphertext: string): string {
	const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");
	const iv = Buffer.from(ivHex, "hex");
	const authTag = Buffer.from(authTagHex, "hex");
	const encrypted = Buffer.from(encryptedHex, "hex");
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);
	return decipher.update(encrypted) + decipher.final("utf8");
}

const envKey = (): Buffer => Buffer.from(config.ENCRYPTION_KEY, "hex");

/** Encrypt with the server env key. Used for non-credential secrets (settings). */
export function encrypt(plaintext: string): string {
	return encryptWithKey(envKey(), plaintext);
}

export function decrypt(ciphertext: string): string {
	return decryptWithKey(envKey(), ciphertext);
}

/**
 * One-way sha-256 hex digest. Used to fingerprint API key tokens so only the
 * hash is persisted — the plaintext token is shown to the user exactly once.
 */
export function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
