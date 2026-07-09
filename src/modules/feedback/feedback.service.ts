import config from "@/config";
import { buildError } from "@/utils/errors";
import { subscribeToListmonk } from "@/utils/listmonk";
import { createLogger } from "@/utils/logger";
import {
	isMailerConfigured,
	type MailAttachment,
	sendMail,
} from "@/utils/mailer";

const log = createLogger("feedback");

const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

export interface FeedbackInput {
	email: string;
	feature: string;
	message: string;
	otherText?: string;
	files?: File[];
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export class FeedbackService {
	static async submit(input: FeedbackInput) {
		const to = config.FEEDBACK_EMAIL;
		if (!to || !isMailerConfigured()) {
			log.warn("Feedback received but mailer/recipient not configured");
			buildError("storeUnavailable", {
				info: "Feedback is temporarily unavailable. Please try again later.",
			});
		}

		const files = input.files ?? [];
		if (files.length > MAX_FILES) {
			buildError("badRequest", { info: `Attach at most ${MAX_FILES} files.` });
		}

		let total = 0;
		const attachments: MailAttachment[] = [];
		for (const file of files) {
			const content = Buffer.from(await file.arrayBuffer());
			total += content.length;
			if (total > MAX_TOTAL_BYTES) {
				buildError("badRequest", {
					info: "Attachments are too large (max 15 MB total).",
				});
			}
			attachments.push({ content, filename: file.name || "attachment" });
		}

		const feature =
			input.feature === "Other" && input.otherText?.trim()
				? `Other — ${input.otherText.trim()}`
				: input.feature;

		const attachmentNote = attachments.length
			? `<p style="color:#71717a; font-size:13px;">${attachments.length} attachment(s)</p>`
			: "";
		const html = `<div style="font-family: -apple-system, sans-serif; max-width: 600px; color:#18181b;">
			<h2 style="margin:0 0 12px;">New product feedback</h2>
			<p style="margin:4px 0;"><strong>From:</strong> ${escapeHtml(input.email)}</p>
			<p style="margin:4px 0;"><strong>Feature:</strong> ${escapeHtml(feature)}</p>
			<p style="margin:12px 0 4px;"><strong>Message:</strong></p>
			<p style="white-space:pre-wrap; line-height:1.5;">${escapeHtml(input.message)}</p>
			${attachmentNote}
		</div>`;

		const text = [
			"New product feedback",
			`From: ${input.email}`,
			`Feature: ${feature}`,
			"",
			input.message,
			attachments.length ? `\n${attachments.length} attachment(s)` : "",
		].join("\n");

		const sent = await sendMail({
			attachments,
			html,
			replyTo: input.email,
			subject: `AppBoard feedback — ${feature}`,
			text,
			to,
		});
		if (!sent) {
			buildError("storeUnavailable", {
				info: "Could not send your feedback right now. Please try again.",
			});
		}

		// Best-effort: add the submitter to the newsletter list (never blocks).
		void subscribeToListmonk(input.email);

		log.info({ feature, from: input.email }, "Feedback submitted");
		return { success: true };
	}
}
