import {
  primarySubBeat,
  SUBDIVISION_STEPS,
  type Subdivision,
  type TripletTarget,
} from "@/components/sync-recorder";
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

type BeatDotProps = {
  active: boolean;
  // The "primary" sub-beat (see PRIMARY_SUB_BEAT in sync-recorder.tsx) is
  // drawn bigger/brighter; every other sub-beat is drawn smaller/dimmer.
  // Normally that's the native quarter beat itself — but for "eighth"
  // specifically, only the off-beat is actually judged by peak detection,
  // so it's the off-beat that gets the prominent style here instead, even
  // though the quarter is still shown (demoted to secondary).
  isPrimary: boolean;
};

function BeatDot({ active, isPrimary }: BeatDotProps) {
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
    shadowOpacity: glow.value * (isPrimary ? 0.9 : 0.45),
    transform: [{ scale: 1 + glow.value * (isPrimary ? 0.15 : 0.25) }],
  }));

  return (
    <Animated.View
      className={
        isPrimary
          ? "w-4 h-4 rounded-full border-[1.5px]"
          : "w-2 h-2 rounded-full border"
      }
      style={[
        {
          shadowColor: ACTIVE_COLOR,
          shadowRadius: isPrimary ? 8 : 4,
          shadowOffset: { width: 0, height: 0 },
          opacity: isPrimary ? 1 : 0.85,
        },
        style,
      ]}
    />
  );
}

type BeatIndicatorProps = {
  isActive: boolean;
  bpm: number;
  subdivision?: Subdivision;
  tripletTarget?: TripletTarget;
};

export default function BeatIndicator({
  isActive,
  bpm,
  subdivision = "quarter",
  tripletTarget = 2,
}: BeatIndicatorProps) {
  const steps = SUBDIVISION_STEPS[subdivision];
  const primarySub = primarySubBeat(subdivision, tripletTarget);

  // currentPoint spans 0..BEATS_PER_BAR*steps-1: sub-beat 0 of each quarter
  // is native truth (from onBeat), sub-beats 1..steps-1 have no native
  // event and are predicted from the BPM instead.
  const [currentPoint, setCurrentPoint] = useState<number | null>(null);
  const fallbackIndexRef = useRef(0);
  const bpmRef = useRef(bpm);
  const stepsRef = useRef(steps);
  const subTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onBeat",
      ({ beat }: BeatEventPayload) => {
        const quarterIndex =
          typeof beat === "number" ? beat % BEATS_PER_BAR : fallbackIndexRef.current;
        fallbackIndexRef.current = (quarterIndex + 1) % BEATS_PER_BAR;

        for (const t of subTimeoutsRef.current) clearTimeout(t);
        subTimeoutsRef.current = [];

        const stepCount = stepsRef.current;
        const base = quarterIndex * stepCount;
        setCurrentPoint(base);

        const subIntervalMs = 60000 / bpmRef.current / stepCount;
        for (let sub = 1; sub < stepCount; sub++) {
          subTimeoutsRef.current.push(
            setTimeout(() => {
              setCurrentPoint(base + sub);
            }, sub * subIntervalMs),
          );
        }
      },
    );
    return () => {
      subscription.remove();
      for (const t of subTimeoutsRef.current) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      fallbackIndexRef.current = 0;
      for (const t of subTimeoutsRef.current) clearTimeout(t);
      subTimeoutsRef.current = [];
    }
  }, [isActive]);

  const displayedPoint = isActive ? currentPoint : null;

  return (
    <View className="flex-row items-center justify-center gap-4">
      {Array.from({ length: BEATS_PER_BAR }).map((_, groupIndex) => (
        <View key={groupIndex} className="flex-row items-center gap-1.5">
          {Array.from({ length: steps }).map((_, sub) => (
            <BeatDot
              key={sub}
              isPrimary={sub === primarySub}
              active={groupIndex * steps + sub === displayedPoint}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
