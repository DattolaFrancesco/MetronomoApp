import BeatIndicator from "@/components/beat-indicator";
import DarkPanel from "@/components/dark-panel";
import { GlowDivider } from "@/components/session-setup";
import SyncRecorder, { type SessionSummary } from "@/components/sync-recorder";
import TempoRuler, { APP_BPM_MAX } from "@/components/tempo-ruler";
import {
  CHALLENGE_TOLERANCE_MS,
  CHALLENGES,
  scoreBattereLevareChallenge,
  type Challenge,
  type ChallengeDifficulty,
  type ChallengeResult,
} from "@/lib/challenges";
import { useKeepAwake } from "expo-keep-awake";
import { LinearGradient } from "expo-linear-gradient";
import ExpoPrecisionMetronomeModule, {
  BPM_MIN,
  type BeatEventPayload,
  setBpm as setEngineBpm,
  start,
  stop,
} from "expo-precision-metronome";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Self-contained sibling to the free-session flow in app/index.tsx — its
// own local list/session/report state machine, mounted/unmounted as a
// whole from Home via a single "showChallenges" flag. Deliberately does
// not touch app/index.tsx's own state, SyncRecorder, or lib/rhythm-
// detection.ts: every "already validated" piece of logic it needs
// (peak detection, timestamp math, analyzeSession) is reused exactly as
// free mode uses it, just recomposed — see lib/challenges.ts.

const ACCENT_COLOR = "#FF3B30";
const SUCCESS_COLOR = "#39FF6A";
const FAIL_COLOR = "#FF453A";
const COUNT_IN_BEATS = 4;

type Phase = "idle" | "countIn" | "recording";

const DIFFICULTY_LABEL: Record<ChallengeDifficulty, string> = {
  facile: "Facile",
  medio: "Medio",
  difficile: "Difficile",
};
const DIFFICULTY_COLOR: Record<ChallengeDifficulty, string> = {
  facile: SUCCESS_COLOR,
  medio: "#FF9F0A",
  difficile: FAIL_COLOR,
};

function DifficultyBadge({ difficulty }: { difficulty: ChallengeDifficulty }) {
  const color = DIFFICULTY_COLOR[difficulty];
  return (
    <View
      className="rounded-full px-2.5 py-1"
      style={{ borderWidth: 1, borderColor: color }}
    >
      <Text
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color }}
      >
        {DIFFICULTY_LABEL[difficulty]}
      </Text>
    </View>
  );
}

type ChallengeScreenProps = {
  onBack: () => void;
};

export default function ChallengeScreen({ onBack }: ChallengeScreenProps) {
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);

  if (activeChallenge) {
    return (
      <ChallengeSession
        challenge={activeChallenge}
        onBack={() => setActiveChallenge(null)}
      />
    );
  }

  return <ChallengeList onSelect={setActiveChallenge} onBack={onBack} />;
}

// Scrollable list, ordered easiest to hardest (see CHALLENGES) — only one
// real entry today, but laid out to hold more without changes.
function ChallengeList({
  onSelect,
  onBack,
}: {
  onSelect: (challenge: Challenge) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={["#242426", "#1C1C1E", "#141416"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <Pressable
        onPress={onBack}
        className="absolute w-10 h-10 rounded-full items-center justify-center active:opacity-60"
        style={{
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
        }}
      >
        <Text className="text-white text-lg">←</Text>
      </Pressable>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 40,
          gap: 16,
        }}
      >
        <Text
          className="text-center text-lg font-extrabold uppercase tracking-[3px]"
          style={{ color: ACCENT_COLOR }}
        >
          Challenge
        </Text>

        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />

        {CHALLENGES.map((challenge) => (
          <Pressable
            key={challenge.id}
            onPress={() => onSelect(challenge)}
            className="active:opacity-70"
          >
            <DarkPanel className="px-4 py-4 gap-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-white text-base font-bold">
                  {challenge.name}
                </Text>
                <DifficultyBadge difficulty={challenge.difficulty} />
              </View>
              <Text className="text-neutral-500 text-xs leading-4">
                {challenge.description}
              </Text>
            </DarkPanel>
          </Pressable>
        ))}
      </ScrollView>
    </LinearGradient>
  );
}

function ChallengeSession({
  challenge,
  onBack,
}: {
  challenge: Challenge;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [bpm, setBpm] = useState(90);
  const [phase, setPhase] = useState<Phase>("idle");
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const [result, setResult] = useState<ChallengeResult | null>(null);

  const phaseRef = useRef<Phase>("idle");

  useKeepAwake();

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Same count-in display pattern as the free recording screen (see
  // app/index.tsx) — display-only, the real phase transition comes from
  // SyncRecorder's onRecordingStart below.
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

  const applyBpm = (newBpm: number) => {
    const clamped = Math.min(APP_BPM_MAX, Math.max(BPM_MIN, newBpm));
    setBpm(clamped);
    if (phase !== "idle") setEngineBpm(clamped);
  };

  const handleStart = async () => {
    setResult(null);
    setCountInBeat(null);
    setPhase("countIn");
    await start(bpm);
  };

  const handleStop = async () => {
    await stop();
    setPhase("idle");
    setCountInBeat(null);
  };

  const handleBack = async () => {
    if (phase !== "idle") {
      await stop();
      setPhase("idle");
      setCountInBeat(null);
    }
    onBack();
  };

  const handleRecordingStart = () => {
    setCountInBeat(null);
    setPhase("recording");
  };

  // Fixed at CHALLENGE_BARS (2) — SyncRecorder auto-stops itself once
  // both bars have played, same maxBars mechanism free mode's setup-screen
  // bars picker already relies on.
  const handleLimitReached = () => {
    stop();
    setPhase("idle");
    setCountInBeat(null);
  };

  // The 8-hit pass/fail verdict comes entirely from re-analyzing the raw
  // waveform SyncRecorder just recorded — see scoreBattereLevareChallenge.
  // subdivision="quarter" below is only ever used for SyncRecorder's own
  // (here unused) live approximate status flash, never for this result.
  const handleSessionEnd = (summary: SessionSummary) => {
    setResult(
      scoreBattereLevareChallenge(summary.waveform, summary.bpm, summary.leadInMs),
    );
  };

  const isCountIn = phase === "countIn";

  if (result) {
    return (
      <ChallengeReport
        result={result}
        onRetry={() => setResult(null)}
        onExit={onBack}
      />
    );
  }

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
            onPress={handleBack}
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
            {challenge.name}
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

        {phase !== "idle" && <BeatIndicator isActive bpm={bpm} />}

        <SyncRecorder
          isArmed={phase !== "idle"}
          countInBeats={COUNT_IN_BEATS}
          bpm={bpm}
          subdivision="quarter"
          toleranceMs={CHALLENGE_TOLERANCE_MS}
          maxBars={2}
          onSessionEnd={handleSessionEnd}
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
          onPress={phase !== "idle" ? handleStop : handleStart}
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

// Deliberately much simpler than SessionReport (components/session-report.tsx)
// — a pass/fail verdict plus which of the 8 expected hits were on time, no
// debug chart or rhythmic notation.
function ChallengeReport({
  result,
  onRetry,
  onExit,
}: {
  result: ChallengeResult;
  onRetry: () => void;
  onExit: () => void;
}) {
  const insets = useSafeAreaInsets();
  const color = result.passed ? SUCCESS_COLOR : FAIL_COLOR;
  const onTimeCount = result.hits.filter((h) => h.onTime).length;

  return (
    <LinearGradient
      colors={["#242426", "#1C1C1E", "#141416"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <Pressable
        onPress={onExit}
        className="absolute w-10 h-10 rounded-full items-center justify-center active:opacity-60"
        style={{
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
        }}
      >
        <Text className="text-white text-lg">←</Text>
      </Pressable>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 40,
          gap: 20,
        }}
      >
        <DarkPanel className="px-4 py-6 gap-3 w-full items-center">
          <Text
            className="text-4xl font-bold text-center"
            style={{
              color,
              textShadowColor: color,
              textShadowRadius: 20,
              textShadowOffset: { width: 0, height: 0 },
            }}
          >
            {result.passed ? "Sei un grande! 🔥" : "Sfigato! 😅"}
          </Text>
          <Text className="text-white/60 text-sm text-center">
            {result.passed
              ? "Tutti e 8 i colpi erano a tempo."
              : "Non tutti i colpi erano a tempo — riprova!"}
          </Text>
          <Text className="text-white/40 text-xs font-semibold mt-1">
            {onTimeCount} su {result.hits.length} a tempo
          </Text>
        </DarkPanel>

        <View className="gap-2">
          {result.hits.map((hit, i) => (
            <View
              key={`${hit.label}-${i}`}
              className="flex-row items-center justify-between rounded-lg px-3.5 py-2.5"
              style={{
                backgroundColor: "rgba(255,255,255,0.04)",
                borderWidth: 1,
                borderColor: hit.onTime
                  ? "rgba(57,255,106,0.35)"
                  : "rgba(255,69,58,0.35)",
              }}
            >
              <Text className="text-white text-sm font-semibold">
                {hit.label}
              </Text>
              <Text
                className="text-sm font-bold"
                style={{ color: hit.onTime ? SUCCESS_COLOR : FAIL_COLOR }}
              >
                {hit.onTime ? "✓" : "✗"}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={onRetry}
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
            style={{
              color: ACCENT_COLOR,
              textShadowColor: "rgba(255,59,48,0.6)",
              textShadowRadius: 12,
              textShadowOffset: { width: 0, height: 0 },
            }}
          >
            Riprova
          </Text>
        </Pressable>
      </ScrollView>
    </LinearGradient>
  );
}
