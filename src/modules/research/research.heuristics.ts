import type {
	HeuristicBucket,
	HeuristicStats,
	ResearchReview,
} from "./research.types";

// Keyword-based categorization (EN + PL) — works without an LLM.
const BUCKETS: Record<string, { label: string; keywords: string[] }> = {
	"brak-funkcji": {
		keywords: [
			"missing",
			"wish it",
			"no option",
			"can't even",
			"cannot even",
			"feature",
			"dark mode",
			"landscape",
			"widget",
			"brakuje",
			"przydałoby",
			"przydaloby",
			"nie ma opcji",
			"powinno być",
			"powinno byc",
			"dodajcie",
			"funkcj",
		],
		label: "Missing features",
	},
	"crash-bugi": {
		keywords: [
			"crash",
			"freez",
			"bug",
			"glitch",
			"broken",
			"error",
			"doesn't work",
			"does not work",
			"not working",
			"stopped working",
			"blank screen",
			"white screen",
			"black screen",
			"force clos",
			"nie działa",
			"nie dziala",
			"błąd",
			"blad",
			"wywala",
			"zawiesza",
			"zacina",
			"wysypuje",
			"crashuje",
		],
		label: "Crashes / Bugs",
	},
	logowanie: {
		keywords: [
			"login",
			"log in",
			"sign in",
			"signin",
			"password",
			"logged out",
			"authentication",
			"verification code",
			"face id",
			"touch id",
			"logowa",
			"zalogować",
			"zalogowac",
			"hasło",
			"haslo",
			"wylogow",
			"konto",
		],
		label: "Login / Account",
	},
	"obsluga-klienta": {
		keywords: [
			"support",
			"customer service",
			"no response",
			"contacted",
			"help center",
			"obsług",
			"obslug",
			"wsparci",
			"kontakt",
			"odpowiedzi",
		],
		label: "Customer support",
	},
	platnosci: {
		keywords: [
			"payment",
			"subscription",
			"charge",
			"refund",
			"billing",
			"paywall",
			"purchase",
			"money",
			"expensive",
			"płatnoś",
			"platnos",
			"subskrypcj",
			"opłat",
			"oplat",
			"pieniądze",
			"pieniadze",
			"drogo",
			"zwrot",
			"abonament",
			"premium",
		],
		label: "Payments / Subscriptions",
	},
	powiadomienia: {
		keywords: ["notification", "push", "alert", "powiadomie", "przypomnien"],
		label: "Notifications",
	},
	reklamy: {
		keywords: ["ads", "advert", "ad ", "reklam"],
		label: "Ads / Monetization",
	},
	"sync-offline": {
		keywords: [
			"sync",
			"offline",
			"connection",
			"refresh",
			"not updating",
			"real time",
			"synchroniz",
			"połączeni",
			"polaczeni",
			"internet",
			"odśwież",
			"odswiez",
		],
		label: "Sync / Offline",
	},
	"update-zepsul": {
		keywords: [
			"update broke",
			"since the update",
			"after update",
			"after the update",
			"last update",
			"new update",
			"latest update",
			"used to work",
			"used to be",
			"po aktualizacji",
			"po update",
			"ostatnia aktualizacja",
			"nowa wersja",
			"wcześniej działało",
			"wczesniej dzialalo",
			"kiedyś działało",
			"kiedys dzialalo",
		],
		label: "Update broke something",
	},
	"ux-ui": {
		keywords: [
			"outdated",
			"old design",
			"ugly",
			"clunky",
			"interface",
			"user friendly",
			"hard to use",
			"confusing",
			"navigation",
			"dated",
			"design",
			"layout",
			"nieintuicyj",
			"interfejs",
			"wygląd",
			"wyglad",
			"brzydk",
			"nieczytel",
			"przestarzał",
			"przestarzal",
			"nawigacj",
		],
		label: "UX / UI",
	},
	wydajnosc: {
		keywords: [
			"slow",
			"lag",
			"loading",
			"takes forever",
			"spinning",
			"unresponsive",
			"sluggish",
			"battery",
			"drain",
			"wolno",
			"wolne",
			"muli",
			"ładuje się",
			"laduje sie",
			"bateri",
			"zamula",
			"długo się",
			"dlugo sie",
		],
		label: "Performance",
	},
};

const MAX_QUOTES = 3;
const MAX_QUOTE_LEN = 220;
const NEGATIVE_MAX_STARS = 3;

export function computeHeuristics(reviews: ResearchReview[]): HeuristicStats {
	const byStars: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
	const counts: Record<string, { count: number; quotes: string[] }> = {};

	for (const r of reviews) {
		if (r.stars >= 1 && r.stars <= 5) byStars[r.stars]++;
		if (r.stars > NEGATIVE_MAX_STARS) continue;
		const text = `${r.title ?? ""} ${r.text}`.toLowerCase();
		for (const [id, bucket] of Object.entries(BUCKETS)) {
			if (!bucket.keywords.some((k) => text.includes(k))) continue;
			counts[id] ??= { count: 0, quotes: [] };
			counts[id].count++;
			if (
				counts[id].quotes.length < MAX_QUOTES &&
				r.text.length <= MAX_QUOTE_LEN * 2
			) {
				counts[id].quotes.push(
					`[${r.stars}★] ${r.text.slice(0, MAX_QUOTE_LEN)}`,
				);
			}
		}
	}

	const negative = reviews.filter((r) => r.stars <= NEGATIVE_MAX_STARS).length;
	const buckets: HeuristicBucket[] = Object.entries(counts)
		.map(([id, c]) => ({ id, label: BUCKETS[id].label, ...c }))
		.sort((a, b) => b.count - a.count);

	return {
		buckets,
		byStars,
		negative,
		negativeShare: reviews.length ? negative / reviews.length : 0,
		total: reviews.length,
	};
}
