import BeatIndicator from "@/components/beat-indicator";
import DarkPanel from "@/components/dark-panel";
import MicPermissionGate from "@/components/mic-permission-gate";
import SessionReport from "@/components/session-report";
import SessionSetup, { GlowDivider } from "@/components/session-setup";
import SyncRecorder, {
  type OnsetStatus,
  type SessionSummary,
  type SixteenthTarget,
  type Subdivision,
  type TripletTarget,
} from "@/components/sync-recorder";
import { useKeepAwake } from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import ExpoPrecisionMetronomeModule, {
  BPM_MIN,
  type BeatEventPayload,
  setBpm as setEngineBpm,
  setPattern,
  setSound,
  start,
  stop,
} from "expo-precision-metronome";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ACCENT_COLOR = "#FF3B30";
const COUNT_IN_BEATS = 4;

// Single-word subdivision label for the recording screen's header — the
// recording screen is in English; the setup screen's Tempo carousel (see
// components/session-setup.tsx's TEMPO_OPTIONS) stays in Italian.
const SUBDIVISION_LABELS: Record<Subdivision, string> = {
  quarter: "Quarters",
  eighth: "Eighths",
  triplet: "Triplets",
  sixteenth: "Sixteenths",
};

type Phase = "idle" | "countIn" | "recording";

const TOLERANCE_MIN_MS = 10;
const TOLERANCE_MAX_MS = 120;
const DEFAULT_TOLERANCE_MS = 100;

const STATUS_META: Record<OnsetStatus, { label: string; color: string }> = {
  onTime: { label: "ON TIME", color: "#39FF6A" },
  early: { label: "EARLY", color: "#FF9F0A" },
  late: { label: "LATE", color: "#FF453A" },
};
const IDLE_COLOR = ACCENT_COLOR;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function StatusDot({ color }: { color: string }) {
  return (
    <View
      className="w-2 h-2 rounded-full"
      style={{
        backgroundColor: color,
        shadowColor: color,
        shadowOpacity: 0.8,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 0 },
      }}
    />
  );
}

// Draggable continuous slider (30-200ms) with a glowing red thumb/track —
// only visible/editable while phase === "idle", same as the triplet-note
// picker below, so the choice locks in before the count-in starts.
function ToleranceSlider({
  toleranceMs,
  onChange,
}: {
  toleranceMs: number;
  onChange: (ms: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const THUMB_SIZE = 22;

  const updateFromX = (x: number) => {
    if (trackWidth <= 0) return;
    const ratio = clamp(x / trackWidth, 0, 1);
    onChange(Math.round(TOLERANCE_MIN_MS + ratio * (TOLERANCE_MAX_MS - TOLERANCE_MIN_MS)));
  };

  // Not memoized: Gesture objects are cheap, plain descriptors (not native
  // handles), and GestureDetector is meant to receive a fresh one each
  // render — this is the pattern react-native-gesture-handler's own docs
  // use (see the pinch gesture in debug-chart.tsx). That means this always
  // closes over the current trackWidth/onChange with no ref needed.
  const pan = Gesture.Pan()
    .onBegin((e) => {
      "worklet";
      runOnJS(updateFromX)(e.x);
    })
    .onUpdate((e) => {
      "worklet";
      runOnJS(updateFromX)(e.x);
    });

  const ratio =
    trackWidth === 0
      ? 0
      : clamp((toleranceMs - TOLERANCE_MIN_MS) / (TOLERANCE_MAX_MS - TOLERANCE_MIN_MS), 0, 1);
  const thumbX = ratio * trackWidth;

  return (
    <DarkPanel className="px-5 py-5 gap-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-neutral-500 text-[11px] font-bold uppercase tracking-[2px]">
          Tolerance
        </Text>
        <Text className="text-white text-sm font-extrabold">{toleranceMs}ms</Text>
      </View>

      <GestureDetector gesture={pan}>
        <View
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          style={{ height: 28, justifyContent: "center" }}
        >
          <View
            style={{ height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)" }}
          />
          <View
            style={{
              position: "absolute",
              left: 0,
              height: 3,
              width: thumbX,
              borderRadius: 2,
              backgroundColor: ACCENT_COLOR,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: thumbX - THUMB_SIZE / 2,
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: ACCENT_COLOR,
              shadowColor: ACCENT_COLOR,
              shadowOpacity: 0.8,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 0 },
            }}
          />
        </View>
      </GestureDetector>
    </DarkPanel>
  );
}

// How many screen pixels of horizontal drag equal one BPM step. The tick
// strip itself now scrolls with the drag (see TempoTick/TempoRuler below)
// — only the centered accent tick stays fixed, representing "current
// value", same visual language as a camera exposure dial.
const PX_PER_BPM = 6;

// UI-exposed BPM ceiling — the native engine (BPM_MIN/BPM_MAX from
// expo-precision-metronome) actually goes up to 300, but the app never
// lets the user dial past this. The floor stays the engine's own BPM_MIN
// (20) — only the top end is narrowed here.
const APP_BPM_MAX = 200;
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

function TempoRuler({
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

// Which off-beat sub-beat to evaluate — shared between "triplet" (2/3) and
// "sixteenth" (2/3/4). The 1st note always coincides with the
// quarter/battere, so it's never a selectable option for either (see
// TripletTarget/SixteenthTarget).
function TargetPicker<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row items-center justify-center gap-3">
      <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
        {label}
      </Text>
      <View className="flex-row gap-2">
        {options.map((n) => {
          const selected = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              className="w-9 h-9 rounded-lg items-center justify-center active:opacity-70"
              style={{
                borderWidth: 2,
                borderColor: selected ? ACCENT_COLOR : "rgba(255,255,255,0.25)",
                backgroundColor: selected
                  ? "rgba(255,59,48,0.15)"
                  : "transparent",
              }}
            >
              <Text
                className="text-sm font-bold"
                style={{ color: selected ? ACCENT_COLOR : "#F2F2F7" }}
              >
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function Home() {
  const [bpm, setBpm] = useState(120);
  const [phase, setPhase] = useState<Phase>("idle");
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const [report, setReport] = useState<SessionSummary | null>(null);
  const [syncStatus, setSyncStatus] = useState<OnsetStatus | null>(null);
  const [syncOffsetMs, setSyncOffsetMs] = useState<number | null>(null);

  // UI-only setup step, shown before every session — no wiring to bpm/phase
  // or the metronome engine yet, just local visual selection state (see
  // components/session-setup.tsx).
  const [showSetup, setShowSetup] = useState(true);
  // Gates the setup UI below until microphone access is granted — see
  // components/mic-permission-gate.tsx, which also fires the native
  // permission prompt itself the first time this is false.
  const [micGranted, setMicGranted] = useState(false);
  const [setupBars, setSetupBars] = useState(1);
  const [setupSubdivision, setSetupSubdivision] = useState<Subdivision>("quarter");
  // Which triplet note (2nd or 3rd) to evaluate — only meaningful when
  // setupSubdivision is "triplet". Chosen on the recording screen itself,
  // not the setup step (see the picker below, gated to phase === "idle").
  const [tripletTarget, setTripletTarget] = useState<TripletTarget>(2);
  // Same idea as tripletTarget, for "sixteenth" (2nd/3rd/4th sixteenth note).
  const [sixteenthTarget, setSixteenthTarget] = useState<SixteenthTarget>(2);
  const [toleranceMs, setToleranceMs] = useState(DEFAULT_TOLERANCE_MS);

  const phaseRef = useRef<Phase>("idle");
  const insets = useSafeAreaInsets();

  useKeepAwake();

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    setSound("beep");
    setPattern(["strong", "normal", "normal", "normal"]);

    return () => {
      stop();
    };
  }, []);

  // Drives the "1, 2, 3, 4" count-in display only — display-only, so a
  // render cycle of lag here doesn't matter. `beat` starts at 0 on every
  // start(), so beats 0..COUNT_IN_BEATS-1 are the count-in. The actual
  // switch to "recording" phase comes from SyncRecorder's onRecordingStart,
  // which fires synchronously on the real beat that ends the count-in —
  // see handleRecordingStart below for why that authority lives there.
  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onBeat",
      ({ beat }: BeatEventPayload) => {
        if (phaseRef.current !== "countIn") return;
        if (beat < COUNT_IN_BEATS) {
          setCountInBeat(beat + 1);
        }
      },
    );
    return () => subscription.remove();
  }, []);

  const togglePlay = async () => {
    if (phase !== "idle") {
      await stop();
      setPhase("idle");
      setCountInBeat(null);
      setShowSetup(true);
    } else {
      setReport(null);
      setSyncStatus(null);
      setSyncOffsetMs(null);
      setCountInBeat(null);
      setPhase("countIn");
      await start(bpm);
    }
  };

  // Leaves the setup step and reveals the metronome screen underneath —
  // setupBars and setupSubdivision are both wired to the real session now
  // (passed to SyncRecorder below).
  const handleSetupStart = () => {
    setShowSetup(false);
  };

  // Back button on the recording screen itself — stops whatever's running
  // first (same as the manual Stop path) so a mid-session return to setup
  // never leaves the engine or SyncRecorder armed underneath.
  const handleBackToSetup = async () => {
    if (phase !== "idle") {
      await stop();
      setPhase("idle");
      setCountInBeat(null);
    }
    setShowSetup(true);
  };

  // SyncRecorder calls this once, synchronously, the instant the bars
  // chosen on the setup screen have elapsed — it only knows about
  // beats/audio, not the native engine, so actually stopping it lives here.
  // Manual Stop (the red button, via togglePlay above) still works at any
  // time regardless — this is an additional automatic trigger for the same
  // stop path, not a replacement for it.
  const handleLimitReached = () => {
    stop();
    setPhase("idle");
    setCountInBeat(null);
    setShowSetup(true);
  };

  const applyBpm = (newBpm: number) => {
    const clamped = clamp(newBpm, BPM_MIN, APP_BPM_MAX);
    setBpm(clamped);
    if (phase !== "idle") setEngineBpm(clamped);
  };

  const handleSessionEnd = (summary: SessionSummary) => {
    if (summary.events.length > 0) {
      setReport(summary);
    }
  };

  const handleStatusChange = (
    status: OnsetStatus | null,
    offsetMs: number | null,
  ) => {
    setSyncStatus(status);
    setSyncOffsetMs(offsetMs);
  };

  // SyncRecorder calls this the instant it actually starts recording —
  // authoritative because it fires synchronously from the same onBeat event
  // that ends the count-in, not from watching a prop we'd have to flip
  // first. This is UI-only (swaps the count-in number for the status row).
  const handleRecordingStart = () => {
    setCountInBeat(null);
    setPhase("recording");
  };

  if (report) {
    return (
      <View className="flex-1 bg-black">
        <SessionReport
          summary={report}
          onNewSession={() => {
            // Back to the metronome/recording screen, not the setup step —
            // bars/subdivision already chosen stay as they are.
            setReport(null);
            setShowSetup(false);
          }}
        />
      </View>
    );
  }

  if (showSetup) {
    return (
      <LinearGradient
        colors={["#242426", "#1C1C1E", "#141416"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          flex: 1,
          paddingHorizontal: 20,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        {micGranted ? (
          <SessionSetup
            bars={setupBars}
            onBarsChange={setSetupBars}
            subdivision={setupSubdivision}
            onSubdivisionChange={setSetupSubdivision}
            onStart={handleSetupStart}
          />
        ) : (
          <MicPermissionGate onGranted={() => setMicGranted(true)} />
        )}
      </LinearGradient>
    );
  }

  const isCountIn = phase === "countIn";
  const statusMeta = syncStatus ? STATUS_META[syncStatus] : null;
  const label = statusMeta
    ? statusMeta.label
    : phase === "recording"
      ? "LISTENING"
      : "READY";
  const color = statusMeta ? statusMeta.color : IDLE_COLOR;

  return (
    <LinearGradient
      colors={["#242426", "#1C1C1E", "#141416"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <View
        className="flex-1 px-5 justify-between"
        style={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View style={{ height: 40, justifyContent: "center" }}>
          <Pressable
            onPress={handleBackToSetup}
            className="absolute w-10 h-10 rounded-full items-center justify-center active:opacity-60"
            style={{
              left: 0,
              zIndex: 10,
              backgroundColor: "rgba(255,255,255,0.06)",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.12)",
            }}
          >
            <Text className="text-white text-lg">←</Text>
          </Pressable>
          <Text
            className="text-center text-lg font-extrabold uppercase tracking-[3px]"
            style={{ color: ACCENT_COLOR }}
          >
            {SUBDIVISION_LABELS[setupSubdivision]}
          </Text>
        </View>

        <GlowDivider />

        {isCountIn && (
          <View className="items-center justify-center py-2">
            <Text
              className="text-8xl font-bold text-white"
              style={{ lineHeight: 104 }}
            >
              {countInBeat ?? ""}
            </Text>
          </View>
        )}

        {/* Only shown once a session is actually running (after Start) —
            the setup screen already lets you preview subdivisions before
            starting, so there's nothing useful to light up while idle. */}
        {phase !== "idle" && (
          <BeatIndicator
            isActive
            bpm={bpm}
            subdivision={setupSubdivision}
            tripletTarget={tripletTarget}
            sixteenthTarget={sixteenthTarget}
          />
        )}

        {/* Which off-beat note to evaluate — only meaningful for
            "triplet"/"sixteenth", and only changeable before Start (the
            count-in/recording locks it in, same as bars/tempo on the setup
            screen). See TargetPicker. */}
        {setupSubdivision === "triplet" && phase === "idle" && (
          <TargetPicker
            label="Note to evaluate"
            options={[2, 3] as const}
            value={tripletTarget}
            onChange={setTripletTarget}
          />
        )}
        {setupSubdivision === "sixteenth" && phase === "idle" && (
          <TargetPicker
            label="Note to evaluate"
            options={[2, 3, 4] as const}
            value={sixteenthTarget}
            onChange={setSixteenthTarget}
          />
        )}

        {phase === "idle" && (
          <ToleranceSlider toleranceMs={toleranceMs} onChange={setToleranceMs} />
        )}

        {!isCountIn && (
          <DarkPanel className="flex-row items-center justify-between px-5 py-3.5">
            <View className="flex-row items-center gap-2">
              <StatusDot color={color} />
              <Text className="text-xs font-bold tracking-[1px]" style={{ color }}>
                {label}
              </Text>
            </View>
            <Text className="text-white/70 text-xs font-semibold">
              {syncOffsetMs === null
                ? "−"
                : `${syncOffsetMs > 0 ? "+" : ""}${Math.round(syncOffsetMs)} ms`}
            </Text>
          </DarkPanel>
        )}

        <SyncRecorder
          isArmed={phase !== "idle"}
          countInBeats={COUNT_IN_BEATS}
          bpm={bpm}
          subdivision={setupSubdivision}
          tripletTarget={tripletTarget}
          sixteenthTarget={sixteenthTarget}
          toleranceMs={toleranceMs}
          maxBars={setupBars}
          onSessionEnd={handleSessionEnd}
          onStatusChange={handleStatusChange}
          onRecordingStart={handleRecordingStart}
          onLimitReached={handleLimitReached}
        />

        <View className="items-center">
          <Text className="text-7xl font-bold text-white">{bpm}</Text>
          <Text
            className="text-xs font-bold tracking-widest mt-1"
            style={{ color: ACCENT_COLOR }}
          >
            BPM
          </Text>
        </View>

        <TempoRuler bpm={bpm} onChange={applyBpm} />

        <Pressable
          onPress={togglePlay}
          className="self-stretch py-5 rounded-2xl items-center justify-center active:opacity-70 border-2 flex-row gap-2.5"
          style={{
            borderColor: ACCENT_COLOR,
            shadowColor: ACCENT_COLOR,
            shadowOpacity: 0.5,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          {phase !== "idle" ? (
            <View style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: ACCENT_COLOR }} />
          ) : (
            <View
              style={{
                width: 0,
                height: 0,
                borderTopWidth: 9,
                borderBottomWidth: 9,
                borderLeftWidth: 14,
                borderTopColor: "transparent",
                borderBottomColor: "transparent",
                borderLeftColor: ACCENT_COLOR,
              }}
            />
          )}
          <Text
            className="text-xl font-extrabold uppercase tracking-widest"
            style={{
              color: ACCENT_COLOR,
              textShadowColor: "rgba(255,59,48,0.6)",
              textShadowRadius: 12,
              textShadowOffset: { width: 0, height: 0 },
            }}
          >
            {phase !== "idle" ? "Stop" : "Start"}
          </Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}
