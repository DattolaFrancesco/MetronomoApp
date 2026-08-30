// Local, on-device onboarding flags — no account/backend, same trade-off
// as lib/challenge-progress.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";

// Whether the user has permanently dismissed the wired-headphones notice
// (components/wired-headphones-notice.tsx) via its "Don't show this again"
// checkbox. Dismissing the notice *without* checking that box doesn't
// persist anything — it's meant to reappear on every launch until the
// user explicitly opts out.
const WIRED_HEADPHONES_NOTICE_KEY = "onboarding:wiredHeadphonesNoticeDismissed";

export async function getHasDismissedWiredHeadphonesNotice(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WIRED_HEADPHONES_NOTICE_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markWiredHeadphonesNoticeDismissed(): Promise<void> {
  await AsyncStorage.setItem(WIRED_HEADPHONES_NOTICE_KEY, "true");
}

// Single boolean key for the main spotlight tour (setup → session preview
// → report preview — see app/index.tsx's MAIN_TOUR_STEPS/startTour call).
// It's one atomic startTour() call end to end (the session/report steps
// are shown against fake preview state, not a real recording — see
// lib/fake-report.ts), so unlike the Challenge tour there's no
// multi-stage/multi-visit tracking to do here.
const MAIN_TOUR_SEEN_KEY = "onboarding:mainTourSeen";

export async function getHasSeenMainTour(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(MAIN_TOUR_SEEN_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markMainTourSeen(): Promise<void> {
  await AsyncStorage.setItem(MAIN_TOUR_SEEN_KEY, "true");
}

// Separate, single boolean key for the Challenge-section tour — independent
// of the main tour's own stage above by design (see the spec: two
// separate persistence keys, one per tour), so a user who already saw the
// main tour but hasn't opened Challenge yet (or vice versa) still gets
// exactly the one tour that's actually new to them.
const CHALLENGE_TOUR_SEEN_KEY = "onboarding:challengeTourSeen";

export async function getHasSeenChallengeTour(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CHALLENGE_TOUR_SEEN_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markChallengeTourSeen(): Promise<void> {
  await AsyncStorage.setItem(CHALLENGE_TOUR_SEEN_KEY, "true");
}

// Used by the settings screen's "Replay challenge tutorial" — clears the
// flag and lets ChallengeList's own mount effect (see
// components/challenge-screen.tsx) auto-fire the tour again, exactly as if
// this were the first-ever visit.
export async function resetChallengeTourSeen(): Promise<void> {
  await AsyncStorage.removeItem(CHALLENGE_TOUR_SEEN_KEY);
}
