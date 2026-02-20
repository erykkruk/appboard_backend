import { SettingsService } from "@/modules/settings/settings.service";
import { createLogger } from "@/utils/logger";

const log = createLogger("ai-service");

const MOCK_RESPONSE = {
	mock: true,
	result:
		"AI features require an OpenRouter API key. Configure it in Settings.",
};

export class AIService {
	private static async getApiKey(): Promise<string | null> {
		return SettingsService.getRaw("OPENROUTER_API_KEY");
	}

	static async translate(text: string, targetLanguages: string[]) {
		const apiKey = await AIService.getApiKey();
		if (!apiKey) {
			return {
				mock: true,
				translations: targetLanguages.reduce(
					(acc, lang) => {
						acc[lang] =
							`[Mock translation to ${lang}]: ${text.substring(0, 100)}...`;
						return acc;
					},
					{} as Record<string, string>,
				),
			};
		}

		// Real implementation would call OpenRouter
		log.info("OpenRouter translation not yet implemented");
		return MOCK_RESPONSE;
	}

	static async generateDescription(
		appName: string,
		prompt: string,
		platform?: string,
		keywords?: string[],
	) {
		const apiKey = await AIService.getApiKey();
		if (!apiKey) {
			return {
				description: `${appName} is an innovative app that ${prompt}. Download now to experience the future of mobile technology. Features include seamless integration, intuitive design, and powerful performance.`,
				mock: true,
			};
		}

		log.info("OpenRouter description generation not yet implemented");
		return MOCK_RESPONSE;
	}

	static async suggestKeywords(
		appName: string,
		description?: string,
		category?: string,
		currentKeywords?: string[],
	) {
		const apiKey = await AIService.getApiKey();
		if (!apiKey) {
			return {
				keywords: [
					appName.toLowerCase(),
					"productivity",
					"mobile",
					"app",
					"tools",
					"management",
					"tracker",
					"organizer",
					"planner",
					"utility",
				],
				mock: true,
			};
		}

		log.info("OpenRouter keyword suggestion not yet implemented");
		return MOCK_RESPONSE;
	}

	static async draftReply(
		reviewText: string,
		rating: number,
		authorName: string,
		tone?: string,
	) {
		const apiKey = await AIService.getApiKey();
		if (!apiKey) {
			const isPositive = rating >= 4;
			return {
				mock: true,
				reply: isPositive
					? `Thank you for your wonderful review, ${authorName}! We're thrilled that you enjoy our app. Your feedback motivates us to keep improving.`
					: `Thank you for your feedback, ${authorName}. We're sorry to hear about your experience. We take all feedback seriously and are working to improve. Please reach out to our support team if you need assistance.`,
			};
		}

		log.info("OpenRouter draft reply not yet implemented");
		return MOCK_RESPONSE;
	}

	static async generateReleaseNotes(
		appName: string,
		version: string,
		changes: string[],
	) {
		const apiKey = await AIService.getApiKey();
		if (!apiKey) {
			const changeList = changes.map((c) => `- ${c}`).join("\n");
			return {
				mock: true,
				releaseNotes: `What's New in ${appName} v${version}\n\n${changeList}\n\nThank you for using ${appName}! We appreciate your continued support.`,
			};
		}

		log.info("OpenRouter release notes generation not yet implemented");
		return MOCK_RESPONSE;
	}
}
