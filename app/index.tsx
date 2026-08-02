import BeatIndicator from "@/components/beat-indicator";
import DarkPanel from "@/components/dark-panel";
import SessionReport from "@/components/session-report";
import SessionSetup from "@/components/session-setup";
import SyncRecorder, {
  type OnsetStatus,
  type SessionSummary,
  type Subdivision,
  type TripletTarget,
} from "@/components/sync-recorder";
import { useKeepAwake } from "expo-keep-awake";
import ExpoPrecisionMetronomeModule, {
  BPM_MAX,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BPM_STEP = 5;
const BPM_COLOR = "#39FF6A";
const COUNT_IN_BEATS = 4;

const SUBDIVISION_LABELS: Record<Subdivision, string> = {
  quarter: "Quarti",
  eighth: "Quarti · Ottavi",
  triplet: "Quarti · Terzine",
  sixteenth: "Quarti · Sedicesimi",
};

type Phase = "idle" | "countIn" | "recording";

const STATUS_META: Record<
  OnsetStatus,
  { label: string; color: string; bg: string }
> = {
  onTime: { label: "A TEMPO", color: "#39FF6A", bg: "rgba(57,255,106,0.12)" },
  early: {
    label: "IN ANTICIPO",
    color: "#FF9F0A",
    bg: "rgba(255,159,10,0.12)",
  },
  late: { label: "IN RITARDO", color: "#FF453A", bg: "rgba(255,69,58,0.12)" },
};
const IDLE_META = { color: "#8E8E93", bg: "rgba(142,142,147,0.10)" };

function StatusDot({ color }: { color: string }) {
  return (
    <View className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
  );
}

function RoundButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="w-14 h-14 rounded-full border border-white/20 items-center justify-center active:opacity-60"
    >
      <Text className="text-2xl font-semibold text-white">{label}</Text>
    </Pressable>
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
  const [setupBars, setSetupBars] = useState(1);
  const [setupSubdivision, setSetupSubdivision] = useState<Subdivision>("quarter");
  // Which triplet note (2nd or 3rd) to evaluate — only meaningful when
  // setupSubdivision is "triplet". Chosen on the recording screen itself,
  // not the setup step (see the picker below, gated to phase === "idle").
  const [tripletTarget, setTripletTarget] = useState<TripletTarget>(2);

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
  // (passed to SyncRecorder/BeatIndicator below).
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

  const changeBpm = (delta: number) => {
    const newBpm = Math.min(BPM_MAX, Math.max(BPM_MIN, bpm + delta));
    setBpm(newBpm);
    if (phase !== "idle") setEngineBpm(newBpm);
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
      <View
        className="flex-1 bg-black px-5 justify-center"
        style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
      >
        <SessionSetup
          bars={setupBars}
          onBarsChange={setSetupBars}
          subdivision={setupSubdivision}
          onSubdivisionChange={setSetupSubdivision}
          onStart={handleSetupStart}
        />
      </View>
    );
  }

  const isCountIn = phase === "countIn";
  const statusMeta = syncStatus ? STATUS_META[syncStatus] : null;
  const label = statusMeta
    ? statusMeta.label
    : phase === "recording"
      ? "IN ASCOLTO"
      : "PRONTO";
  const color = statusMeta ? statusMeta.color : IDLE_META.color;
  const bg = statusMeta ? statusMeta.bg : IDLE_META.bg;

  return (
    <View className="flex-1 bg-black">
      <Pressable
        onPress={handleBackToSetup}
        className="absolute w-10 h-10 rounded-full items-center justify-center active:opacity-60"
        style={{
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
          backgroundColor: "rgba(255,255,255,0.08)",
        }}
      >
        <Text className="text-white text-lg">←</Text>
      </Pressable>

      <View
        className="flex-1 px-5 justify-between"
        style={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
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

        <DarkPanel className="px-5 py-5 gap-4">
          <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
            {SUBDIVISION_LABELS[setupSubdivision]}
          </Text>
          <BeatIndicator
            isActive={phase !== "idle"}
            bpm={bpm}
            subdivision={setupSubdivision}
            tripletTarget={tripletTarget}
          />

          {/* Which triplet note to evaluate — only meaningful for "triplet",
              and only changeable before Start (the count-in/recording
              locks it in, same as bars/tempo on the setup screen). The
              1st note always coincides with the quarter/battere, so it's
              never a selectable target — only "2"/"3" (see TripletTarget). */}
          {setupSubdivision === "triplet" && phase === "idle" && (
            <View className="flex-row items-center justify-center gap-3">
              <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
                Nota da valutare
              </Text>
              <View className="flex-row gap-2">
                {([2, 3] as const).map((n) => {
                  const selected = tripletTarget === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setTripletTarget(n)}
                      className="w-9 h-9 rounded-lg items-center justify-center active:opacity-70"
                      style={{
                        borderWidth: 2,
                        borderColor: selected ? BPM_COLOR : "rgba(255,255,255,0.25)",
                        backgroundColor: selected
                          ? "rgba(57,255,106,0.15)"
                          : "transparent",
                      }}
                    >
                      <Text
                        className="text-sm font-bold"
                        style={{ color: selected ? BPM_COLOR : "#F2F2F7" }}
                      >
                        {n}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </DarkPanel>

        {!isCountIn && (
          <View
            className="flex-row items-center justify-between px-5 py-3.5 rounded-2xl border"
            style={{ backgroundColor: bg, borderColor: `${color}33` }}
          >
            <View className="flex-row items-center gap-2">
              <StatusDot color={color} />
              <Text
                className="text-xs font-bold tracking-[1px]"
                style={{ color }}
              >
                {label}
              </Text>
            </View>
            <Text className="text-white/70 text-xs font-semibold">
              {syncOffsetMs === null
                ? "—"
                : `${syncOffsetMs > 0 ? "+" : ""}${Math.round(syncOffsetMs)} ms`}
            </Text>
          </View>
        )}

        <SyncRecorder
          isArmed={phase !== "idle"}
          countInBeats={COUNT_IN_BEATS}
          bpm={bpm}
          subdivision={setupSubdivision}
          tripletTarget={tripletTarget}
          maxBars={setupBars}
          onSessionEnd={handleSessionEnd}
          onStatusChange={handleStatusChange}
          onRecordingStart={handleRecordingStart}
          onLimitReached={handleLimitReached}
        />

        <View className="items-center">
          <Text className="text-7xl font-bold" style={{ color: BPM_COLOR }}>
            {bpm}
          </Text>
          <Text className="text-neutral-500 text-xs font-semibold tracking-widest mt-1">
            BPM
          </Text>
        </View>

        <View className="flex-row items-center justify-center gap-10 mt-2">
          <RoundButton label="−" onPress={() => changeBpm(-BPM_STEP)} />
          <RoundButton label="+" onPress={() => changeBpm(BPM_STEP)} />
        </View>

        <Pressable
          onPress={togglePlay}
          className="self-center w-20 h-20 rounded-full items-center justify-center mt-2"
          style={{
            backgroundColor: "#FF3B30",
            shadowColor: "#FF3B30",
            shadowOpacity: 0.6,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          <View
            style={
              phase !== "idle"
                ? {
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    backgroundColor: "white",
                  }
                : {
                    width: 0,
                    height: 0,
                    borderTopWidth: 12,
                    borderBottomWidth: 12,
                    borderLeftWidth: 20,
                    borderTopColor: "transparent",
                    borderBottomColor: "transparent",
                    borderLeftColor: "white",
                    marginLeft: 4,
                  }
            }
          />
        </Pressable>
      </View>
    </View>
  );
}
