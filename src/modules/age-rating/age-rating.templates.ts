import type { AppleAnswerValue, AppleRatingQuestion } from "@/config/const";

type AppleQuestionnaire = Record<AppleRatingQuestion, AppleAnswerValue>;

export interface AgeRatingPreset {
	appleQuestionnaire: AppleQuestionnaire;
	appleRating: string;
	description: string;
	googleQuestionnaire: Record<string, string | boolean>;
	googleRating: string;
	id: string;
	name: string;
}

const NO_CONTENT_QUESTIONNAIRE: AppleQuestionnaire = {
	ADVERTISING: "NONE",
	AGE_ASSURANCE: "NONE",
	ALCOHOL_TOBACCO_DRUG_USE: "NONE",
	CARTOON_FANTASY_VIOLENCE: "NONE",
	CONTESTS: "NONE",
	GAMBLING: "NONE",
	GAMBLING_CONTESTS: "NONE",
	GRAPHIC_SEXUAL_CONTENT_NUDITY: "NONE",
	GUNS_OR_OTHER_WEAPONS: "NONE",
	HEALTH_OR_WELLNESS_TOPICS: "NONE",
	HORROR_FEAR_THEMES: "NONE",
	LOOT_BOX: "NONE",
	MATURE_SUGGESTIVE: "NONE",
	MEDICAL_TREATMENT_INFO: "NONE",
	MESSAGING_AND_CHAT: "NONE",
	PARENTAL_CONTROLS: "NONE",
	PROFANITY_CRUDE_HUMOR: "NONE",
	PROLONGED_GRAPHIC_SADISTIC_REALISTIC_VIOLENCE: "NONE",
	REALISTIC_VIOLENCE: "NONE",
	SEXUAL_CONTENT_NUDITY: "NONE",
	SIMULATED_GAMBLING: "NONE",
	UNRESTRICTED_WEB_ACCESS: "NONE",
	USER_GENERATED_CONTENT: "NONE",
};

export const AGE_RATING_PRESETS: AgeRatingPreset[] = [
	{
		appleQuestionnaire: { ...NO_CONTENT_QUESTIONNAIRE },
		appleRating: "4+",
		description: "No objectionable content",
		googleQuestionnaire: {
			contains_ads: false,
			drugs: "none",
			gambling: false,
			profanity: "none",
			sexual_content: "none",
			shares_location: false,
			user_interaction: false,
			violence: "none",
		},
		googleRating: "EVERYONE",
		id: "everyone",
		name: "Everyone (4+ / EVERYONE)",
	},
	{
		appleQuestionnaire: {
			...NO_CONTENT_QUESTIONNAIRE,
			CARTOON_FANTASY_VIOLENCE: "INFREQUENT_MILD",
			HORROR_FEAR_THEMES: "INFREQUENT_MILD",
		},
		appleRating: "9+",
		description: "Mild cartoon violence or fantasy themes",
		googleQuestionnaire: {
			contains_ads: false,
			drugs: "none",
			gambling: false,
			profanity: "none",
			sexual_content: "none",
			shares_location: false,
			user_interaction: false,
			violence: "mild",
		},
		googleRating: "EVERYONE_10+",
		id: "everyone_mild",
		name: "Everyone Mild (9+ / EVERYONE 10+)",
	},
	{
		appleQuestionnaire: {
			...NO_CONTENT_QUESTIONNAIRE,
			ADVERTISING: "INFREQUENT_MILD",
			CARTOON_FANTASY_VIOLENCE: "FREQUENT_INTENSE",
			MATURE_SUGGESTIVE: "INFREQUENT_MILD",
			PROFANITY_CRUDE_HUMOR: "INFREQUENT_MILD",
			REALISTIC_VIOLENCE: "INFREQUENT_MILD",
			USER_GENERATED_CONTENT: "INFREQUENT_MILD",
		},
		appleRating: "12+",
		description: "Moderate violence, mild language, suggestive themes",
		googleQuestionnaire: {
			contains_ads: true,
			drugs: "none",
			gambling: false,
			profanity: "mild",
			sexual_content: "mild",
			shares_location: false,
			user_interaction: true,
			violence: "moderate",
		},
		googleRating: "TEEN",
		id: "teen",
		name: "Teen (12+ / TEEN)",
	},
	{
		appleQuestionnaire: {
			...NO_CONTENT_QUESTIONNAIRE,
			ADVERTISING: "FREQUENT_INTENSE",
			ALCOHOL_TOBACCO_DRUG_USE: "INFREQUENT_MILD",
			GUNS_OR_OTHER_WEAPONS: "INFREQUENT_MILD",
			HORROR_FEAR_THEMES: "FREQUENT_INTENSE",
			MATURE_SUGGESTIVE: "FREQUENT_INTENSE",
			MESSAGING_AND_CHAT: "INFREQUENT_MILD",
			PROFANITY_CRUDE_HUMOR: "FREQUENT_INTENSE",
			REALISTIC_VIOLENCE: "FREQUENT_INTENSE",
			SEXUAL_CONTENT_NUDITY: "INFREQUENT_MILD",
			USER_GENERATED_CONTENT: "FREQUENT_INTENSE",
		},
		appleRating: "17+",
		description:
			"Intense violence, mature themes, strong language, mild sexual content",
		googleQuestionnaire: {
			contains_ads: true,
			drugs: "reference",
			gambling: false,
			profanity: "strong",
			sexual_content: "moderate",
			shares_location: true,
			user_interaction: true,
			violence: "intense",
		},
		googleRating: "MATURE",
		id: "mature",
		name: "Mature (17+ / MATURE)",
	},
	{
		appleQuestionnaire: { ...NO_CONTENT_QUESTIONNAIRE },
		appleRating: "4+",
		description: "Fill in your own questionnaire answers",
		googleQuestionnaire: {},
		googleRating: "EVERYONE",
		id: "custom",
		name: "Custom",
	},
];

export function getAgeRatingPreset(
	presetId: string,
): AgeRatingPreset | undefined {
	return AGE_RATING_PRESETS.find((p) => p.id === presetId);
}

const FREQUENT_INTENSE_WEIGHT = 2;
const INFREQUENT_MILD_WEIGHT = 1;

const SEVERITY_THRESHOLDS = {
	FOUR_PLUS: 0,
	NINE_PLUS: 1,
	SEVENTEEN_PLUS: 5,
	TWELVE_PLUS: 3,
} as const;

export function computeAppleRating(
	questionnaire: Record<string, string>,
): string {
	let score = 0;

	for (const value of Object.values(questionnaire)) {
		if (value === "FREQUENT_INTENSE") {
			score += FREQUENT_INTENSE_WEIGHT;
		} else if (value === "INFREQUENT_MILD") {
			score += INFREQUENT_MILD_WEIGHT;
		}
	}

	if (score >= SEVERITY_THRESHOLDS.SEVENTEEN_PLUS) return "17+";
	if (score >= SEVERITY_THRESHOLDS.TWELVE_PLUS) return "12+";
	if (score >= SEVERITY_THRESHOLDS.NINE_PLUS) return "9+";
	return "4+";
}
