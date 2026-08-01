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

const ACTIVE_COLOR = "#39FF6A";
const ACTIVE_TRANSPARENT = "rgba(57,255,106,0)";
const INACTIVE_BORDER = "#3A3A3C";

type PointVariant = "quarter" | "eighth";

type BeatDotProps = {
  active: boolean;
  variant: PointVariant;
};

function BeatDot({ active, variant }: BeatDotProps) {
  const glow = useSharedValue(0);
  const isQuarter = variant === "quarter";

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
    shadowOpacity: glow.value * (isQuarter ? 0.9 : 0.45),
    transform: [{ scale: 1 + glow.value * (isQuarter ? 0.15 : 0.25) }],
  }));

  return (
    <Animated.View
      className={
        isQuarter
          ? "w-4 h-4 rounded-full border-[1.5px]"
          : "w-2 h-2 rounded-full border"
      }
      style={[
        {
          shadowColor: ACTIVE_COLOR,
          shadowRadius: isQuarter ? 8 : 4,
          shadowOffset: { width: 0, height: 0 },
          opacity: isQuarter ? 1 : 0.85,
        },
        style,
      ]}
    />
  );
}

type BeatIndicatorProps = {
  isActive: boolean;
  bpm: number;
};

export default function BeatIndicator({ isActive, bpm }: BeatIndicatorProps) {
  // currentPoint spans 0-7: even indices are quarters (native truth from
  // onBeat), odd indices are the eighths in between ("e" of "1 e 2 e 3 e 4 e"),
  // which have no native event and are predicted from the BPM instead.
  const [currentPoint, setCurrentPoint] = useState<number | null>(null);
  const fallbackIndexRef = useRef(0);
  const bpmRef = useRef(bpm);
  const eighthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onBeat",
      ({ beat }: BeatEventPayload) => {
        const quarterIndex =
          typeof beat === "number" ? beat % BEATS_PER_BAR : fallbackIndexRef.current;
        fallbackIndexRef.current = (quarterIndex + 1) % BEATS_PER_BAR;

        if (eighthTimeoutRef.current) clearTimeout(eighthTimeoutRef.current);

        setCurrentPoint(quarterIndex * 2);

        const halfIntervalMs = 30000 / bpmRef.current;
        eighthTimeoutRef.current = setTimeout(() => {
          setCurrentPoint(quarterIndex * 2 + 1);
        }, halfIntervalMs);
      },
    );
    return () => {
      subscription.remove();
      if (eighthTimeoutRef.current) clearTimeout(eighthTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      fallbackIndexRef.current = 0;
      if (eighthTimeoutRef.current) {
        clearTimeout(eighthTimeoutRef.current);
        eighthTimeoutRef.current = null;
      }
    }
  }, [isActive]);

  const displayedPoint = isActive ? currentPoint : null;

  return (
    <View className="flex-row items-center justify-center gap-4">
      {Array.from({ length: BEATS_PER_BAR }).map((_, groupIndex) => (
        <View key={groupIndex} className="flex-row items-center gap-1.5">
          <BeatDot variant="quarter" active={groupIndex * 2 === displayedPoint} />
          <BeatDot variant="eighth" active={groupIndex * 2 + 1 === displayedPoint} />
        </View>
      ))}
    </View>
  );
}
