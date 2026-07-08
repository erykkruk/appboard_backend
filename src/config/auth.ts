import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import nodemailer from "nodemailer";
import config from "@/config";
import { db } from "@/utils/db";
import { schema } from "@/utils/db/schema";
import { createLogger } from "@/utils/logger";

const log = createLogger("auth");
const smtpConfigured = !!(
	config.SMTP_HOST &&
	config.SMTP_USER &&
	config.SMTP_PASS
);

const DEV_OTP = "123456";
const isDev = config.NODE_ENV !== "production";

// Dev-only OTP fallback. When SMTP is unconfigured in a NON-production
// environment we accept a fixed code so local login works without email.
// This is gated on isDev (never `!smtpConfigured` alone) so production can
// never silently enable a fixed-OTP login. The startup guard below makes the
// unsafe state (production without SMTP) impossible by refusing to boot.
const useDevOtp = isDev && !smtpConfigured;

if (!isDev && !smtpConfigured) {
	throw new Error(
		"SMTP must be configured in production: set SMTP_HOST, SMTP_USER and SMTP_PASS",
	);
}

// Dev mode: store real OTP per email so we can swap "123456" → real code
const devOtpStore = new Map<string, string>();

let transporter: nodemailer.Transporter | null = null;
if (smtpConfigured) {
	transporter = nodemailer.createTransport({
		auth: {
			pass: config.SMTP_PASS,
			user: config.SMTP_USER,
		},
		host: config.SMTP_HOST,
		port: Number(config.SMTP_PORT) || 587,
		secure: false,
	});
}

export const auth = betterAuth({
	advanced: {
		disableCSRFCheck: isDev,
	},
	basePath: "/api/auth",
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: { ...schema },
	}),
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					const { workspaceMembers, workspaces } = await import(
						"@/utils/db/schema"
					);
					const [workspace] = await db
						.insert(workspaces)
						.values({ name: `Workspace ${user.name}` })
						.returning();
					await db.insert(workspaceMembers).values({
						role: "owner",
						userId: user.id,
						workspaceId: workspace.id,
					});
					log.info(
						{ userId: user.id, workspaceId: workspace.id },
						"Auto-created workspace for new user",
					);
				},
			},
		},
	},
	emailAndPassword: { enabled: true },
	plugins: [
		emailOTP({
			expiresIn: 300,
			otpLength: 6,
			async sendVerificationOTP({ email, otp, type }) {
				if (useDevOtp) {
					// Dev mode: remember the real OTP, user enters "123456"
					devOtpStore.set(email, otp);
					log.info({ email, type }, `DEV MODE — use code ${DEV_OTP}`);
					return;
				}

				// Production: send real email via SMTP
				try {
					await transporter!.sendMail({
						from: config.SMTP_FROM || config.SMTP_USER,
						html: `
							<div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 24px;">
								<h2 style="margin-bottom: 16px;">AppBoard</h2>
								<p>Your verification code is:</p>
								<div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f4f4f5; border-radius: 8px; margin: 16px 0;">
									${otp}
								</div>
								<p style="color: #71717a; font-size: 14px;">This code expires in 5 minutes.</p>
							</div>
						`,
						subject: "AppBoard — Your verification code",
						text: `Your verification code is: ${otp}\n\nThis code expires in 5 minutes.`,
						to: email,
					});
					log.info({ email, type }, "OTP email sent via SMTP");
				} catch (err) {
					log.error({ email, err }, "Failed to send OTP email");
					throw new Error("Failed to send verification email");
				}
			},
		}),
	],
	secret: config.BETTER_AUTH_SECRET,
	trustedOrigins: config.ALLOWED_ORIGINS?.split(",") ?? [],
});

// Dev mode: intercept OTP verification — swap "123456" with the real OTP
if (useDevOtp) {
	const originalHandler = auth.handler;
	auth.handler = async (request: Request) => {
		const url = new URL(request.url);
		const isOtpVerify =
			url.pathname.includes("verify-email") ||
			url.pathname.includes("sign-in/email-otp");

		if (isOtpVerify && request.method === "POST") {
			try {
				const body = await request.json();
				if (body.otp === DEV_OTP && body.email) {
					const realOtp = devOtpStore.get(body.email);
					if (realOtp) {
						log.info(
							{ email: body.email },
							`DEV: swapping ${DEV_OTP} → real OTP`,
						);
						devOtpStore.delete(body.email);
						// Rebuild request with real OTP
						const newBody = { ...body, otp: realOtp };
						request = new Request(request.url, {
							body: JSON.stringify(newBody),
							headers: request.headers,
							method: request.method,
						});
					}
				}
			} catch {
				// Not JSON or parse error — pass through
			}
		}

		return originalHandler(request);
	};
}
