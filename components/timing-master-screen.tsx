import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Celebration screen shown once, the moment the player completes the very
// last still-unfinished challenge (see markAllChallengesAchievementSeen in
// lib/challenge-progress.ts — the caller in challenge-screen.tsx is
// responsible for only mounting this after checking every challenge id has
// been completed at least once, and for marking it seen so it never shows
// again on subsequent completions).
//
// Deliberately just the artwork (assets/images/timing_master_achievement.png
// already contains the wordmark, headline, badge, and share prompt),
// full-bleed behind a small close button — no separately-built text/badge
// elements or visible background here.

// Matches the app's own dark background tone (see loading-screen.tsx's
// BACKGROUND_COLOR / the gradient's middle stop elsewhere) — only ever
// visible as a fallback before the image loads, since contentFit="cover"
// fills the whole screen.
const BACKGROUND_COLOR = "#111215";

export default function TimingMasterScreen({
  onClose,
}: {
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: BACKGROUND_COLOR }}>
      <Image
        source={require("@/assets/images/timing_master_achievement.png")}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        contentFit="cover"
      />

      <Pressable
        onPress={onClose}
        className="absolute w-10 h-10 rounded-full items-center justify-center active:opacity-60"
        style={{
          top: insets.top + 12,
          left: 16,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
        }}
      >
        <Text className="text-white text-lg">✕</Text>
      </Pressable>
    </View>
  );
}
