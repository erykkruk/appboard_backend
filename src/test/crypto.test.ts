import { describe, expect, it } from "bun:test";
import { decrypt, encrypt } from "@/utils/crypto";

describe("Crypto utilities", () => {
	it("encrypts and decrypts a string correctly", () => {
		const plaintext = "hello world";
		const encrypted = encrypt(plaintext);
		const decrypted = decrypt(encrypted);
		expect(decrypted).toBe(plaintext);
	});

	it("produces different ciphertexts for the same input", () => {
		const plaintext = "test value";
		const encrypted1 = encrypt(plaintext);
		const encrypted2 = encrypt(plaintext);
		expect(encrypted1).not.toBe(encrypted2);
	});

	it("handles empty strings", () => {
		const encrypted = encrypt("");
		const decrypted = decrypt(encrypted);
		expect(decrypted).toBe("");
	});

	it("handles long strings", () => {
		const plaintext = "a".repeat(10000);
		const encrypted = encrypt(plaintext);
		const decrypted = decrypt(encrypted);
		expect(decrypted).toBe(plaintext);
	});

	it("handles special characters and unicode", () => {
		const plaintext = '{"key": "value", "emoji": "🔑", "pl": "ąęść"}';
		const encrypted = encrypt(plaintext);
		const decrypted = decrypt(encrypted);
		expect(decrypted).toBe(plaintext);
	});

	it("fails to decrypt tampered ciphertext", () => {
		const encrypted = encrypt("secret");
		const parts = encrypted.split(":");
		// Tamper with the encrypted data
		parts[2] = `0000${parts[2].slice(4)}`;
		const tampered = parts.join(":");
		expect(() => decrypt(tampered)).toThrow();
	});
});
