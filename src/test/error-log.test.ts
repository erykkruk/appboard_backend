import { describe, expect, it } from "bun:test";
import { scrubSecrets } from "@/modules/system/error-log.service";

describe("scrubSecrets", () => {
	it("redacts a PEM private key block", () => {
		const input =
			"connect failed -----BEGIN PRIVATE KEY-----\nMIGTAg1234\nabcd==\n-----END PRIVATE KEY----- rest";
		const out = scrubSecrets(input);
		expect(out).not.toContain("MIGTAg1234");
		expect(out).toContain("[REDACTED]");
		expect(out).toContain("connect failed");
		expect(out).toContain("rest");
	});

	it("redacts a bearer token", () => {
		const out = scrubSecrets("Authorization: Bearer abc123.DEF-456_ghi failed");
		expect(out).not.toContain("abc123.DEF-456_ghi");
		expect(out).toContain("[REDACTED]");
	});

	it("redacts sk-/pk- style API keys", () => {
		const out = scrubSecrets("key sk-or-v1-0123456789abcdef0123 used");
		expect(out).not.toContain("sk-or-v1-0123456789abcdef0123");
		expect(out).toContain("[REDACTED]");
	});

	it("redacts a service-account private_key field", () => {
		const out = scrubSecrets('{"private_key":"-----BEGIN...secret...END-----"}');
		expect(out).not.toContain("secret");
		expect(out).toContain("[REDACTED]");
	});

	it("redacts a JWT", () => {
		const jwt =
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature";
		const out = scrubSecrets(`token ${jwt} here`);
		expect(out).not.toContain(jwt);
		expect(out).toContain("[REDACTED]");
	});

	it("leaves ordinary error text untouched", () => {
		const input = "App not found (id 6d02da86)";
		expect(scrubSecrets(input)).toBe(input);
	});
});
