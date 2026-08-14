import { BPM_MIN } from "expo-precision-metronome";
import { useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolateColor,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from "react-native-reanimated";

const ACCENT_COLOR = "#FF3B30";

// UI-exposed BPM ceiling — the native engine (BPM_MIN/BPM_MAX from
// expo-precision-metronome) actually goes up to 300, but the app never
// lets the user dial past this. The floor stays the engine's own BPM_MIN
// (20) — only the top end is narrowed here.
export const APP_BPM_MAX = 200;

// How many screen pixels of horizontal drag equal one BPM step. The tick
// strip itself scrolls with the drag (see TempoTick/TempoRuler below) —
// only the centered accent tick stays fixed, representing "current
// value", same visual language as a camera exposure dial.
const PX_PER_BPM = 6;
// The same BPM_MIN/APP_BPM_MAX bounds, in the px units TempoRuler's
// scrollX is actually clamped in (both live dragging and the inertial
// coast after a fling — see TempoRuler).
const SCROLL_MIN = BPM_MIN * PX_PER_BPM;
const SCROLL_MAX = APP_BPM_MAX * PX_PER_BPM;

// Pixel spacing between adjacent ticks in the scrolling ruler strip below.
const TICK_SPACING = 14;
// A tick within this many px of the fixed center accent grows/lights up —
// gives whichever tick is currently passing under the accent a brief
// "pop", fading out symmetrically as it scrolls away on either side.
const TICK_GLOW_RADIUS = TICK_SPACING;
const TICK_GLOW_SCALE_Y = 2.4;
const TICK_GLOW_SCALE_X = 2.2;
const TICK_DIM_COLOR = "rgba(255,255,255,0.3)";
const TICK_LIT_COLOR = "rgba(255,255,255,0.95)";

function mod(value: number, base: number): number {
  "worklet";
  return ((value % base) + base) % base;
}

// A single tick at a fixed rest position (`index` cells from center) in
// the scrolling ruler strip. `scrollX` is the drag distance in px since
// the ruler was first touched, already clamped to stop moving the instant
// bpm hits BPM_MIN/APP_BPM_MAX (see TempoRuler) — reading it directly (not
// some intermediate "did bpm change" event) is what makes every tick
// visually follow the finger 1:1, exactly like dragging a real ruler under
// a fixed pointer, while still refusing to scroll any further once there's
// nowhere left for the value to go. `translateX` shifts every tick by the
// same wrapped offset each frame; because ticks are spaced exactly
// TICK_SPACING apart and look identical, wrapping that offset back into
// [0, TICK_SPACING) makes the strip read as an infinite ruler from a
// small, fixed set of rendered ticks (see TempoRuler) instead of needing
// to render one per BPM step. The same wrapped offset also gives each
// tick's *current* on-screen distance from the fixed center — driving the
// proximity glow so whichever physical tick currently sits nearest center
// pops as it passes, and hands off smoothly to its neighbor as scrolling
// continues. `isDragging` (0 or 1, eased) gates that glow entirely: at
// rest every tick is small and grey regardless of where it happens to sit,
// so the "in focus" look only ever appears while actively dragging.
function TempoTick({
  index,
  scrollX,
  isDragging,
}: {
  index: number;
  scrollX: SharedValue<number>;
  isDragging: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const wrapped = mod(scrollX.value, TICK_SPACING);
    const distanceFromCenter = index * TICK_SPACING + wrapped;
    const proximity =
      Math.max(0, 1 - Math.abs(distanceFromCenter) / TICK_GLOW_RADIUS) *
      isDragging.value;
    return {
      transform: [
        { translateX: wrapped },
        { scaleX: 1 + proximity * (TICK_GLOW_SCALE_X - 1) },
        { scaleY: 1 + proximity * (TICK_GLOW_SCALE_Y - 1) },
      ],
      backgroundColor: interpolateColor(
        proximity,
        [0, 1],
        [TICK_DIM_COLOR, TICK_LIT_COLOR],
      ),
      shadowOpacity: proximity * 0.9,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: "50%",
          marginLeft: index * TICK_SPACING - 0.5,
          width: 1,
          height: 18,
          borderRadius: 1,
          backgroundColor: TICK_DIM_COLOR,
          shadowColor: "#FFFFFF",
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 0 },
        },
        animatedStyle,
      ]}
    />
  );
}

export default function TempoRuler({
  bpm,
  onChange,
}: {
  bpm: number;
  onChange: (bpm: number) => void;
}) {
  const [width, setWidth] = useState(0);

  // scrollX is the single source of truth for both the ruler's visuals
  // (TempoTick reads it directly) and the bpm value itself — it's always
  // kept equal to bpm*PX_PER_BPM in px, clamped to SCROLL_MIN/SCROLL_MAX
  // (BPM_MIN/APP_BPM_MAX in px). Initialized once from the incoming bpm
  // prop and never resynced from it afterwards: this component is the
  // only thing that ever changes bpm in this app, so re-reading the prop
  // back in would just be reacting to its own output one render later —
  // harmless most of the time, but it would snap scrollX to whole-BPM
  // pixel positions on every frame of a fling below, killing the smooth
  // sub-pixel coast.
  const scrollX = useSharedValue(bpm * PX_PER_BPM);
  const scrollAtGestureStart = useSharedValue(0);
  // 0 at rest, 1 while a finger is down or the ruler is still coasting
  // from a fling — gates TempoTick's glow (see there) so the ruler is
  // small and grey once it's fully settled, and eases in/out instead of
  // cutting sharply.
  const isDragging = useSharedValue(0);

  // The only place scrollX ever turns into a bpm value, so dragging and
  // the inertial coast after a fling (see onEnd below) push updates to
  // `onChange` through the exact same path instead of two separate ones
  // that could disagree. Reanimated calls this on every UI-thread frame
  // scrollX changes; `previous` is null on the very first call (nothing to
  // report yet) and unchanged between no-op frames, both skipped so
  // onChange only fires on a genuine new bpm.
  useAnimatedReaction(
    () => scrollX.value,
    (current, previous) => {
      if (previous === null || current === previous) return;
      const nextBpm = Math.min(
        APP_BPM_MAX,
        Math.max(BPM_MIN, Math.round(current / PX_PER_BPM)),
      );
      runOnJS(onChange)(nextBpm);
    },
  );

  // Not memoized: Gesture objects are cheap, plain descriptors (not native
  // handles), and GestureDetector is meant to receive a fresh one each
  // render — this is the pattern react-native-gesture-handler's own docs
  // use (see the pinch gesture in debug-chart.tsx). That means onBegin
  // always captures the current `scrollX`, with no ref needed.
  const pan = Gesture.Pan()
    .onBegin(() => {
      "worklet";
      scrollAtGestureStart.value = scrollX.value;
      isDragging.value = withTiming(1, { duration: 80 });
    })
    .onUpdate((e) => {
      "worklet";
      // Dragging right increases bpm, left decreases it — same sign as
      // the raw translation, so the strip visually follows the finger.
      scrollX.value = Math.min(
        SCROLL_MAX,
        Math.max(SCROLL_MIN, scrollAtGestureStart.value + e.translationX),
      );
    })
    .onEnd((e) => {
      "worklet";
      // A flick: hand scrollX off to a decay animation seeded with the
      // gesture's release velocity, so the ruler keeps coasting and
      // decelerating on its own instead of stopping dead the instant the
      // finger lifts — same clamp bounds as the live drag above, so a
      // hard fling still glides to a smooth stop exactly at BPM_MIN/
      // APP_BPM_MAX instead of overshooting past them.
      scrollX.value = withDecay(
        {
          velocity: e.velocityX,
          deceleration: 0.995,
          clamp: [SCROLL_MIN, SCROLL_MAX],
        },
        () => {
          isDragging.value = withTiming(0, { duration: 220 });
        },
      );
    })
    .onFinalize((_e, success) => {
      "worklet";
      // Gesture never reached onEnd (e.g. interrupted/cancelled) — the
      // decay above never got scheduled, so this is the only place left
      // to fade the glow back out.
      if (!success) {
        isDragging.value = withTiming(0, { duration: 220 });
      }
    });

  // Enough ticks to cover the measured width plus one extra spacing unit
  // on each side, so wrapping (see TempoTick) never reveals a gap at the
  // edges while dragging.
  const tickHalfCount =
    width > 0 ? Math.ceil(width / 2 / TICK_SPACING) + 1 : 0;

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: 32, justifyContent: "center", overflow: "hidden" }}
      >
        {Array.from({ length: tickHalfCount * 2 + 1 }).map((_, i) => {
          const index = i - tickHalfCount;
          return (
            <TempoTick
              key={index}
              index={index}
              scrollX={scrollX}
              isDragging={isDragging}
            />
          );
        })}

        {/* The fixed reference point everything above scrolls past — never
            animated, always centered, always the same size/color. */}
        <View
          style={{
            position: "absolute",
            left: "50%",
            marginLeft: -1,
            width: 2,
            height: 30,
            borderRadius: 1,
            backgroundColor: ACCENT_COLOR,
            shadowColor: ACCENT_COLOR,
            shadowOpacity: 0.85,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
      </View>
    </GestureDetector>
  );
}
