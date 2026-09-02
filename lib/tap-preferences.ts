// Local, on-device Tap-mode preferences — same trade-off as
// lib/onboarding.ts/lib/challenge-progress.ts (no account/backend).

import AsyncStorage from "@react-native-async-storage/async-storage";

// Whether pressing the Tap button plays its own click sound (see
// components/tap-recorder.tsx's handlePress /
// ExpoPrecisionMetronomeModule.playTapClick). Defaults to on (matches the
// app's original always-on behavior) when nothing has been stored yet.
const TAP_SOUND_ENABLED_KEY = "tapPreferences:soundEnabled";

export async function getTapSoundEnabled(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(TAP_SOUND_ENABLED_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

export async function setTapSoundEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(TAP_SOUND_ENABLED_KEY, enabled ? "true" : "false");
}
