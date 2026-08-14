import DarkPanel from "@/components/dark-panel";
import { getHasSeenTutorial, markTutorialSeen } from "@/lib/onboarding";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ACCENT_COLOR = "#FF3B30";

type Slide = { title: string; body: string };

const SLIDES: Slide[] = [
  {
    title: "Welcome to Timing",
    body: "Timing measures how precisely you play against a metronome. Your device's microphone listens for each hit and checks it against the beat.",
  },
  {
    title: "Training",
    body: "Pick how many bars and which subdivision to practice — quarters, eighths, triplets, or sixteenths — then play along. Every session ends with a full breakdown of each hit.",
  },
  {
    title: "Challenge",
    body: "Work through a set of rhythm challenges with a pass/fail verdict. Each one asks for a different subdivision switch, with a tighter timing tolerance as they get harder.",
  },
  {
    title: "Use headphones",
    body: "For the most accurate detection, wear headphones or earbuds. That keeps the microphone from also picking up the metronome's own click.",
  },
];

type TutorialScreenProps = {
  onDone: () => void;
};

// Shown once, before the mic permission gate — checks AsyncStorage on mount
// and, if the tutorial was already dismissed in a previous session, calls
// onDone immediately without ever rendering anything (same self-gating
// idiom as MicPermissionGate's permission check).
export default function TutorialScreen({ onDone }: TutorialScreenProps) {
  const [checking, setChecking] = useState(true);
  const [index, setIndex] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    getHasSeenTutorial().then((seen) => {
      if (cancelled) return;
      if (seen) {
        onDone();
        return;
      }
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) return null;

  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  const finish = () => {
    markTutorialSeen();
    onDone();
  };

  const handleNext = () => {
    if (isLast) {
      finish();
      return;
    }
    setIndex((i) => i + 1);
  };

  return (
    <LinearGradient
      colors={["#242426", "#1C1C1E", "#141416"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View className="flex-1">
        <Pressable onPress={finish} className="self-end active:opacity-60">
          <Text className="text-neutral-500 text-xs font-bold uppercase tracking-widest">
            Skip
          </Text>
        </Pressable>

        <View className="flex-1 justify-center gap-8">
          <DarkPanel className="px-6 py-8 gap-4 items-center">
            <Text
              className="text-center text-2xl font-extrabold"
              style={{ color: ACCENT_COLOR }}
            >
              {slide.title}
            </Text>
            <Text className="text-white/70 text-base text-center leading-6">
              {slide.body}
            </Text>
          </DarkPanel>

          <View className="flex-row justify-center items-center gap-1.5">
            {SLIDES.map((_, i) => {
              const active = i === index;
              return (
                <View
                  key={i}
                  style={{
                    width: active ? 16 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: active ? ACCENT_COLOR : "rgba(255,255,255,0.25)",
                  }}
                />
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={handleNext}
          className="self-stretch py-5 rounded-2xl items-center active:opacity-70 border-2"
          style={{
            borderColor: ACCENT_COLOR,
            shadowColor: ACCENT_COLOR,
            shadowOpacity: 0.5,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          <Text
            className="text-xl font-extrabold uppercase tracking-widest"
            style={{ color: ACCENT_COLOR }}
          >
            {isLast ? "Get started" : "Next"}
          </Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}
