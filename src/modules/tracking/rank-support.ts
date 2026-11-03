import { type AppDevice, DEFAULT_APP_DEVICES } from "@/config/const";
import {
	platformToStore,
	type ResearchStore,
} from "@/modules/research/research.types";

export type RankSurface = "iphone-search" | "play-search";

/** Where (and whether) rank positions for an app can be measured. */
export interface RankTrackingSupport {
	devices: AppDevice[];
	/** Shown next to the tracker, null when there is nothing to qualify. */
	note: string | null;
	store: ResearchStore;
	supported: boolean;
	surface: RankSurface | null;
}

const TVOS_ONLY_NOTE =
	"Apple publishes no Apple TV (tvOS) search results, so rankings cannot be measured for a tvOS-only app. The listing, audit and reviews still work.";
const TVOS_DEVICE_NOTE =
	"Positions are measured in iPhone App Store search. Apple TV search has no public data source, so the Apple TV side of this app is covered by the listing and audit only.";
const ANDROID_TV_NOTE =
	"Positions are measured in Google Play web search, which ranks this package the same way phone search does. The Android TV launcher search is not public.";

/**
 * Be honest about what a store exposes. Apple has no public tvOS search, so an
 * App Store record that only serves Apple TV cannot be rank-tracked at all;
 * one that also serves iPhone/iPad is tracked in iPhone search. Play web
 * search does return Android TV packages, so those are trackable.
 */
export function rankTrackingSupport(app: {
	devices?: readonly AppDevice[] | null;
	platform: string;
}): RankTrackingSupport {
	const devices = app.devices?.length ? [...app.devices] : DEFAULT_APP_DEVICES;
	const store = platformToStore(app.platform);
	const hasTv = devices.includes("tv");

	if (store === "appstore") {
		const hasHandheld = devices.includes("phone") || devices.includes("tablet");
		if (!hasHandheld) {
			return {
				devices,
				note: TVOS_ONLY_NOTE,
				store,
				supported: false,
				surface: null,
			};
		}
		return {
			devices,
			note: hasTv ? TVOS_DEVICE_NOTE : null,
			store,
			supported: true,
			surface: "iphone-search",
		};
	}

	return {
		devices,
		note: hasTv ? ANDROID_TV_NOTE : null,
		store,
		supported: true,
		surface: "play-search",
	};
}
