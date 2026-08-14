// Whether the first-launch tutorial (components/tutorial-screen.tsx) has
// ever been dismissed — purely local to this device/install, same
// no-account/no-backend trade-off as lib/challenge-progress.ts.

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "onboarding:tutorialSeen";

// Swallows read errors into "not seen yet" rather than throwing — corrupted
// or missing storage shouldn't ever block the tutorial from being skippable
// on a later launch, it should just show it again.
export async function getHasSeenTutorial(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markTutorialSeen(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, "true");
}
