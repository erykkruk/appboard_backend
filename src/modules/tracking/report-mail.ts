import { isMailerConfigured, type MailMessage, sendMail } from "@/utils/mailer";

/**
 * The one door scheduled report emails (rank digest, research report, daily
 * summary) go through. Tests swap `send` / `isConfigured` to see what would
 * have been mailed without an SMTP server.
 */
export const reportMail = {
	isConfigured: (): boolean => isMailerConfigured(),
	send: (message: MailMessage): Promise<boolean> => sendMail(message),
};
