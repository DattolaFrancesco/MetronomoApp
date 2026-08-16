// Tracks which challenges have ever been passed — purely local to this
// device/install (see lib/challenges.ts for the challenges themselves).
// No account, no backend: just a small on-device key-value flag per
// challenge id, so reinstalling the app or switching devices resets
// progress. That's an accepted trade-off for not needing a login.

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { ChallengeId } from "./challenges";

const STORAGE_KEY = "challengeProgress:completedIds";

// Swallows read/parse errors into "nothing completed yet" rather than
// throwing — corrupted or missing storage shouldn't ever block the
// challenge list from rendering.
export async function getCompletedChallengeIds(): Promise<Set<ChallengeId>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed as ChallengeId[]);
  } catch {
    return new Set();
  }
}

export async function markChallengeCompleted(id: ChallengeId): Promise<void> {
  const current = await getCompletedChallengeIds();
  if (current.has(id)) return;
  current.add(id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...current]));
}

// Separate flag for the one-time "you completed every challenge" celebration
// screen (see components/timing-master-screen.tsx) — kept distinct from
// completedIds above so it only ever fires once, even though completedIds
// itself stays "all complete" forever after.
const ACHIEVEMENT_STORAGE_KEY = "challengeProgress:allChallengesAchievementSeen";

export async function hasSeenAllChallengesAchievement(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ACHIEVEMENT_STORAGE_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markAllChallengesAchievementSeen(): Promise<void> {
  await AsyncStorage.setItem(ACHIEVEMENT_STORAGE_KEY, "true");
}
