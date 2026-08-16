import ExpoPrecisionMetronomeModule, {
  type BeatEventPayload,
} from "expo-precision-metronome";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const BEATS_PER_BAR = 4;

const ACTIVE_COLOR = "#FF3B30";
const ACTIVE_TRANSPARENT = "rgba(255,59,48,0)";
const INACTIVE_BORDER = "#3A3A3C";

function BeatDot({ active }: { active: boolean }) {
  const glow = useSharedValue(0);

  useEffect(() => {
    glow.value = withTiming(active ? 1 : 0, { duration: active ? 140 : 220 });
  }, [active, glow]);

  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      glow.value,
      [0, 1],
      [ACTIVE_TRANSPARENT, ACTIVE_COLOR],
    ),
    borderColor: interpolateColor(glow.value, [0, 1], [INACTIVE_BORDER, ACTIVE_COLOR]),
    shadowOpacity: glow.value * 0.9,
    transform: [{ scale: 1 + glow.value * 0.15 }],
  }));

  return (
    <Animated.View
      className="w-4 h-4 rounded-full border-[1.5px]"
      style={[
        {
          shadowColor: ACTIVE_COLOR,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    />
  );
}

type BeatIndicatorProps = {
  isActive: boolean;
};

// One dot per native quarter beat — just the downbeat pulse, regardless of
// which subdivision/off-beat target is selected elsewhere (see
// evaluatedSubBeats in lib/rhythm-detection.ts): this indicator is a plain
// metronome visual, not a guide to the judged off-beat position.
export default function BeatIndicator({ isActive }: BeatIndicatorProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const fallbackIndexRef = useRef(0);

  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onBeat",
      ({ beat }: BeatEventPayload) => {
        const quarterIndex =
          typeof beat === "number" ? beat % BEATS_PER_BAR : fallbackIndexRef.current;
        fallbackIndexRef.current = (quarterIndex + 1) % BEATS_PER_BAR;
        setActiveIndex(quarterIndex);
      },
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isActive) fallbackIndexRef.current = 0;
  }, [isActive]);

  const displayedIndex = isActive ? activeIndex : null;

  return (
    <View className="flex-row items-center justify-center gap-4">
      {Array.from({ length: BEATS_PER_BAR }).map((_, groupIndex) => (
        <BeatDot key={groupIndex} active={groupIndex === displayedIndex} />
      ))}
    </View>
  );
}
