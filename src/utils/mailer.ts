import nodemailer from "nodemailer";
import config from "@/config";
import { createLogger } from "@/utils/logger";

const log = createLogger("mailer");

const smtpConfigured = !!(
	config.SMTP_HOST &&
	config.SMTP_USER &&
	config.SMTP_PASS
);

// Shared SMTP transporter. Mirrors the config used by Better Auth's OTP mailer
// (src/config/auth.ts) — kept separate rather than exported from auth.ts to
// avoid coupling report emails to the auth module.
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

export function isMailerConfigured(): boolean {
	return smtpConfigured;
}

export interface MailMessage {
	to: string;
	subject: string;
	html: string;
	text: string;
}

/**
 * Send a transactional email. Returns `false` (and logs a warning) when SMTP is
 * not configured, so callers can treat email as best-effort without throwing.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
	if (!transporter) {
		log.warn({ to: message.to }, "SMTP not configured — email not sent");
		return false;
	}
	try {
		await transporter.sendMail({
			from: config.SMTP_FROM || config.SMTP_USER,
			html: message.html,
			subject: message.subject,
			text: message.text,
			to: message.to,
		});
		log.info({ subject: message.subject, to: message.to }, "Email sent");
		return true;
	} catch (err) {
		log.error({ err, to: message.to }, "Failed to send email");
		return false;
	}
}
