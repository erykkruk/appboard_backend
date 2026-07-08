/**
 * Generate the APPLE_CLIENT_SECRET (a signed ES256 JWT) for "Sign in with Apple".
 *
 * Apple does not hand you a static client secret — you sign a short-lived JWT
 * with your .p8 key. It is valid for at most 6 months, so re-run this whenever
 * it expires and update the APPLE_CLIENT_SECRET env var on prod.
 *
 * Usage:
 *   APPLE_TEAM_ID=496JHMHJSL \
 *   APPLE_KEY_ID=26B8YUR79W \
 *   APPLE_SERVICES_ID=dev.appboard.web \
 *   APPLE_P8_PATH=keys/signin/AuthKey_26B8YUR79W.p8 \
 *   bun run scripts/gen-apple-secret.ts
 *
 * The token is printed to stdout; everything else goes to stderr so you can pipe:
 *   bun run scripts/gen-apple-secret.ts > keys/signin/apple_client_secret.txt
 */
import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";

const teamId = process.env.APPLE_TEAM_ID;
const keyId = process.env.APPLE_KEY_ID;
const servicesId = process.env.APPLE_SERVICES_ID;
const p8Path = process.env.APPLE_P8_PATH;

const missing = [
	["APPLE_TEAM_ID", teamId],
	["APPLE_KEY_ID", keyId],
	["APPLE_SERVICES_ID", servicesId],
	["APPLE_P8_PATH", p8Path],
]
	.filter(([, v]) => !v)
	.map(([k]) => k);

if (missing.length > 0) {
	process.stderr.write(`Missing env: ${missing.join(", ")}\n`);
	process.exit(1);
}

// Apple caps the secret at 6 months. Use ~180 days minus a small buffer.
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180;
const now = Math.floor(Date.now() / 1000);

const privateKey = await importPKCS8(
	readFileSync(p8Path as string, "utf8"),
	"ES256",
);

const token = await new SignJWT({})
	.setProtectedHeader({ alg: "ES256", kid: keyId })
	.setIssuer(teamId as string)
	.setIssuedAt(now)
	.setExpirationTime(now + SIX_MONTHS_SECONDS)
	.setAudience("https://appleid.apple.com")
	.setSubject(servicesId as string)
	.sign(privateKey);

const expiresOn = new Date((now + SIX_MONTHS_SECONDS) * 1000)
	.toISOString()
	.slice(0, 10);

process.stderr.write(`Apple client secret generated (expires ${expiresOn}).\n`);
process.stderr.write("Set it as APPLE_CLIENT_SECRET on prod:\n\n");
process.stdout.write(`${token}\n`);
