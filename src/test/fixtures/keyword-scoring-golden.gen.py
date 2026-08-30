"""Generate golden scoring values from the original RespectASO code."""
import json, sys, types, datetime as dt

# services.py imports requests at module level; stub it (no network in scoring).
sys.modules.setdefault("requests", types.ModuleType("requests"))
sys.path.insert(0, "respectaso")

from aso import services
from aso.scoring import calc_opportunity, classify_keyword

# Freeze time so age-based signals are deterministic.
FIXED_NOW = dt.datetime(2026, 8, 30, tzinfo=dt.timezone.utc)
class FakeDatetime(dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return FIXED_NOW
services.datetime = FakeDatetime

def comp(title, seller, reviews, rating=4.5, released="2019-01-01T00:00:00Z", genre="Productivity"):
    return {
        "trackName": title, "sellerName": seller, "userRatingCount": reviews,
        "averageUserRating": rating, "releaseDate": released, "primaryGenreName": genre,
    }

FIXTURES = {
    "strong_fitness": {
        "keyword": "fitness",
        "competitors": [
            comp(f"fitness - App {i}", f"Publisher {i}", 200_000 - i * 10_000)
            for i in range(10)
        ],
    },
    "backfill_lan_invoice": {
        "keyword": "lan invoice",
        "competitors": [comp("Lan Invoice Tool", "Tiny Dev", 40)]
        + [comp(f"Giant Unrelated {i}", f"BigCo {i}", 500_000) for i in range(9)],
    },
    "brand_spotify": {
        "keyword": "spotify",
        "competitors": [comp("Spotify: Music and Podcasts", "Spotify AB", 25_000_000, 4.8)]
        + [comp(f"Music App {i}", f"Label {i}", 100_000) for i in range(9)],
    },
    "small_set": {
        "keyword": "obscure niche tool",
        "competitors": [comp("Giant One", "Mega Corp", 2_000_000), comp("Giant Two", "Mega Corp 2", 1_000_000)],
    },
    "mixed_habit": {
        "keyword": "habit tracker",
        "competitors": [
            comp("Habit Tracker - Daily Planner", "HabitCo", 80_000, 4.7, "2017-05-01T00:00:00Z"),
            comp("Habitify: Habit Tracker", "Unstatic", 40_000, 4.6, "2018-02-01T00:00:00Z"),
            comp("Streaks", "Crunchy Bagel", 25_000, 4.8, "2015-06-01T00:00:00Z"),
            comp("Productive - Habit Tracker", "Apalon", 60_000, 4.7, "2016-03-01T00:00:00Z"),
            comp("Loop Habit Tracker", "OpenLoop", 900, 4.4, "2026-01-15T00:00:00Z"),
            comp("Done: A Simple Habit Tracker", "DoneApps", 12_000, 4.5, "2019-09-01T00:00:00Z"),
            comp("Way of Life", "WayOfLife", 8_000, 4.6, "2014-01-01T00:00:00Z"),
            comp("Strides: Goal & Habit Tracker", "Strides", 15_000, 4.7, "2015-11-01T00:00:00Z"),
            comp("Today Planner", "TodayInc", 300, 4.2, "2026-03-01T00:00:00Z", "Lifestyle"),
            comp("Calendar Notes", "NotesCo", 5_000, 4.3, "2020-07-01T00:00:00Z", "Utilities"),
        ],
    },
    "finance_call_options": {
        "keyword": "call options",
        "competitors": [
            comp("Call Recorder", "RecApps", 50_000, 4.2, "2018-01-01T00:00:00Z", "Utilities"),
            comp("Video Call Options", "ChatCo", 30_000, 4.3, "2019-01-01T00:00:00Z", "Social Networking"),
            comp("Options Trading Pro", "TradeCo", 8_000, 4.6, "2020-01-01T00:00:00Z", "Finance"),
            comp("WiFi Calling", "TelApps", 90_000, 4.1, "2017-01-01T00:00:00Z", "Utilities"),
            comp("Stock Options Tracker", "FinTrack", 2_000, 4.5, "2021-01-01T00:00:00Z", "Finance"),
        ],
    },
}

est = services.PopularityEstimator()
calc = services.DifficultyCalculator()
dl = services.DownloadEstimator()

out = {"fixtures": {}}
for name, fx in FIXTURES.items():
    kw, comps = fx["keyword"], fx["competitors"]
    pop = est.estimate(comps, kw)
    score, breakdown = calc.calculate(comps, keyword=kw)
    tiers = {
        t: {k: breakdown["ranking_tiers"][t][k] for k in
            ("tier_score", "label", "min_reviews", "median_reviews", "weak_count",
             "fresh_count", "title_keyword_count", "total_apps")}
        for t in ("top_5", "top_10", "top_20")
    }
    out["fixtures"][name] = {
        "keyword": kw,
        "popularity": pop,
        "difficulty": score,
        "rawTotal": breakdown["raw_total"],
        "overrideReason": breakdown["override_reason"],
        "isBrand": breakdown["is_brand_keyword"],
        "titleMatchCount": breakdown["title_match_count"],
        "medianReviews": breakdown["median_reviews"],
        "opportunity": calc_opportunity(pop or 0, score),
        "classification": classify_keyword(pop, score) if pop is not None else None,
        "tiers": tiers,
    }

out["downloads"] = {
    "pop70_us": dl.estimate(70, "us"),
    "pop40_pl": dl.estimate(40, "pl"),
    "pop40_pk": dl.estimate(40, "pk"),
}
out["opportunity_table"] = {
    f"{p}_{d}": calc_opportunity(p, d)
    for p, d in [(100, 0), (100, 100), (40, 40), (80, 20), (30, 20), (20, 60), (45, 45), (80, 45)]
}
out["classification_table"] = {
    f"{p}_{d}": classify_keyword(p, d)
    for p, d in [(80, 20), (30, 20), (10, 20), (80, 90), (80, 45), (20, 60), (45, 45)]
}
print(json.dumps(out, indent=1))
