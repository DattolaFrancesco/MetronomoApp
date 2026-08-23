import { challengeBars, type Challenge, type ChallengeSegment } from "@/lib/challenges";
import { BEATS_PER_BAR, evaluatedSubBeats, SUBDIVISION_STEPS } from "@/lib/rhythm-detection";
import ExpoPrecisionMetronomeModule, {
  type BeatEventPayload,
} from "expo-precision-metronome";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const ACCENT_COLOR = "#FF3B30";
const INACTIVE_BORDER = "rgba(255,255,255,0.14)";
const TARGET_DOT_SIZE = 12;
const REST_DOT_SIZE = 6;

// One cell's worth of a quarter's sub-beat grid — a small dot row, one dot
// per position in that quarter's own subdivision (see SUBDIVISION_STEPS),
// with the one actually judged (see evaluatedSubBeats) picked out as a
// bigger, accent-colored dot. Glows its border while `active` (this is the
// quarter playing right now).
function QuarterCell({
  segment,
  active,
}: {
  segment: ChallengeSegment;
  active: boolean;
}) {
  const glow = useSharedValue(0);

  useEffect(() => {
    glow.value = withTiming(active ? 1 : 0, { duration: active ? 120 : 220 });
  }, [active, glow]);

  const style = useAnimatedStyle(() => ({
    borderColor: interpolateColor(glow.value, [0, 1], [INACTIVE_BORDER, ACCENT_COLOR]),
    backgroundColor: interpolateColor(
      glow.value,
      [0, 1],
      ["transparent", "rgba(255,59,48,0.12)"],
    ),
  }));

  const steps = SUBDIVISION_STEPS[segment.subdivision];
  const targetIndex = evaluatedSubBeats(
    segment.subdivision,
    segment.tripletTarget,
    segment.sixteenthTarget,
  )[0];

  return (
    <Animated.View
      className="flex-1 items-center justify-center rounded-xl border-2 py-3"
      style={style}
    >
      <View className="flex-row items-center gap-2">
        {Array.from({ length: steps }).map((_, i) => {
          const isTarget = i === targetIndex;
          return (
            <View
              key={i}
              style={{
                width: isTarget ? TARGET_DOT_SIZE : REST_DOT_SIZE,
                height: isTarget ? TARGET_DOT_SIZE : REST_DOT_SIZE,
                borderRadius: 999,
                backgroundColor: isTarget ? ACCENT_COLOR : "rgba(255,255,255,0.28)",
              }}
            />
          );
        })}
      </View>
    </Animated.View>
  );
}

type ChallengeGuideProps = {
  challenge: Challenge;
  // Same count-in length the session's own SyncRecorder/TapRecorder are
  // armed with — needed here to tell a still-counting-in beat apart from
  // the tracked session's real beat 1 (see sessionQuarter below).
  countInBeats: number;
};

// "What to play" guide for a Challenge session — every bar is visible at
// once, stacked top to bottom in playing order, so the player can read
// ahead to whatever's coming instead of only ever seeing the current one
// (this was the whole point of the redesign — see the comment on
// isCurrentBar below). Each row is the current bar's own QuarterCell strip;
// the row matching whichever bar is live right now stays at full opacity
// and gets its live quarter's cell glowing, every other row dims down to a
// glance-able preview/afterthought instead of competing for attention.
// Unlike BeatIndicator (a plain metronome pulse, deliberately blind to
// subdivision — see its own comment), this is an actual guide to the
// target grid, not just a beat pulse.
export default function ChallengeGuide({ challenge, countInBeats }: ChallengeGuideProps) {
  const [beat, setBeat] = useState<number | null>(null);
  const fallbackRef = useRef(0);

  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onBeat",
      ({ beat: nativeBeat }: BeatEventPayload) => {
        const value = typeof nativeBeat === "number" ? nativeBeat : fallbackRef.current;
        fallbackRef.current = value + 1;
        setBeat(value);
      },
    );
    return () => subscription.remove();
  }, []);

  const totalBars = challengeBars(challenge);
  const totalQuarters = totalBars * BEATS_PER_BAR;
  // Beats before countInBeats are still the count-in, not the tracked
  // session — nothing live to highlight yet, every row just shows its own
  // preview at rest.
  const sessionQuarter = beat === null ? null : beat - countInBeats;
  // Clamped so a trailing beat past the challenge's own end (the delayed
  // auto-stop — see handleLimitReached in challenge-screen.tsx) still shows
  // the last bar as current instead of reading past quarterSegments.
  const clampedQuarter =
    sessionQuarter === null || sessionQuarter < 0
      ? null
      : Math.min(sessionQuarter, totalQuarters - 1);
  const barIndex = clampedQuarter === null ? null : Math.floor(clampedQuarter / BEATS_PER_BAR);
  const quarterInBar = clampedQuarter === null ? null : clampedQuarter % BEATS_PER_BAR;

  return (
    <View className="gap-2">
      {Array.from({ length: totalBars }).map((_, bar) => {
        // isCurrentBar drives both this row's own dimming below and (via
        // quarterInBar) which cell inside it gets to glow — before the
        // count-in elapses (barIndex null) nothing is current yet, so
        // every row sits at the same dimmed "preview" resting state.
        const isCurrentBar = bar === barIndex;
        const segments = challenge.quarterSegments.slice(
          bar * BEATS_PER_BAR,
          bar * BEATS_PER_BAR + BEATS_PER_BAR,
        );
        return (
          <View
            key={bar}
            className="flex-row items-center gap-2.5"
            style={{ opacity: isCurrentBar ? 1 : 0.4 }}
          >
            <Text className="text-neutral-500 text-xs font-bold w-4 text-center">
              {bar + 1}
            </Text>
            <View className="flex-row gap-2 flex-1">
              {segments.map((segment, i) => (
                <QuarterCell
                  key={i}
                  segment={segment}
                  active={isCurrentBar && quarterInBar === i}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}
