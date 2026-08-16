import BeatIndicator from "@/components/beat-indicator";
import ChallengeScreen from "@/components/challenge-screen";
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
import TempoRuler, { APP_BPM_MAX } from "@/components/tempo-ruler";
import TutorialScreen from "@/components/tutorial-screen";
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
import { runOnJS, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ACCENT_COLOR = "#FF3B30";
const COUNT_IN_BEATS = 4;

// Single-word subdivision label for the recording screen's header — kept
// separate from the setup screen's Tempo carousel (see
// components/session-setup.tsx's TEMPO_OPTIONS), which uses its own labels.
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

  // Shown once, before everything else (including the mic permission gate)
  // — see components/tutorial-screen.tsx, which self-checks AsyncStorage
  // and calls back immediately without rendering if already dismissed in a
  // previous session.
  const [showTutorial, setShowTutorial] = useState(true);
  // UI-only setup step, shown before every session — no wiring to bpm/phase
  // or the metronome engine yet, just local visual selection state (see
  // components/session-setup.tsx).
  const [showSetup, setShowSetup] = useState(true);
  // Entirely separate flow from the free setup/recording/report above —
  // see components/challenge-screen.tsx, which owns its own list/session/
  // report state once mounted and never touches any of Home's own state.
  const [showChallenges, setShowChallenges] = useState(false);
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
  // Guards togglePlay against a double-tap firing twice before the first
  // tap's setPhase has re-rendered — without this, two rapid taps can both
  // read the same "idle" moment and issue two concurrent start() calls to
  // the native engine.
  const togglingRef = useRef(false);
  // Set synchronously by handleBackToSetup right before it stops a session
  // with hits already in it — otherwise SyncRecorder's teardown would still
  // call handleSessionEnd with a non-empty summary, setReport would win the
  // render race against showSetup (report is checked first), and the user
  // would land on the report screen instead of setup despite explicitly
  // tapping back.
  const suppressReportRef = useRef(false);
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
    if (togglingRef.current) return;
    togglingRef.current = true;
    try {
      if (phase !== "idle") {
        await stop();
        setPhase("idle");
        setCountInBeat(null);
        // Deliberately doesn't go back to setup here — if the session that
        // just ended produced a report, `report` (checked before showSetup
        // below) takes over the screen; if no audio was detected, staying on
        // this recording screen keeps bars/subdivision/BPM as they are so the
        // user can immediately retry instead of being bounced back to setup.
      } else {
        setReport(null);
        setSyncStatus(null);
        setSyncOffsetMs(null);
        setCountInBeat(null);
        setPhase("countIn");
        await start(bpm);
      }
    } finally {
      togglingRef.current = false;
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
      suppressReportRef.current = true;
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
    // Same reasoning as the manual Stop path in togglePlay above — stay on
    // the recording screen unless a report actually comes back.
  };

  const applyBpm = (newBpm: number) => {
    const clamped = clamp(newBpm, BPM_MIN, APP_BPM_MAX);
    setBpm(clamped);
    if (phase !== "idle") setEngineBpm(clamped);
  };

  const handleSessionEnd = (summary: SessionSummary) => {
    if (suppressReportRef.current) {
      suppressReportRef.current = false;
      return;
    }
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

  if (showTutorial) {
    return <TutorialScreen onDone={() => setShowTutorial(false)} />;
  }

  if (showChallenges) {
    return <ChallengeScreen onBack={() => setShowChallenges(false)} />;
  }

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
            onChallenges={() => setShowChallenges(true)}
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
        {phase !== "idle" && <BeatIndicator isActive />}

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

        <TempoRuler bpm={bpm} onChange={applyBpm} disabled={phase !== "idle"} />

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
