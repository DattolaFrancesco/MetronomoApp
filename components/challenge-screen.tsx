import BeatIndicator from "@/components/beat-indicator";
import DarkPanel from "@/components/dark-panel";
import DebugChart from "@/components/debug-chart";
import { GlowDivider } from "@/components/session-setup";
import SyncRecorder, { type SessionSummary } from "@/components/sync-recorder";
import TapRecorder from "@/components/tap-recorder";
import TempoRuler, { APP_BPM_MAX } from "@/components/tempo-ruler";
import TimingMasterScreen from "@/components/timing-master-screen";
import {
  getCompletedChallengeIds,
  hasSeenAllChallengesAchievement,
  markAllChallengesAchievementSeen,
  markChallengeCompleted,
} from "@/lib/challenge-progress";
import {
  challengeBars,
  CHALLENGES,
  scoreChallenge,
  scoreChallengeFromTaps,
  type Challenge,
  type ChallengeDifficulty,
  type ChallengeId,
  type ChallengeResult,
} from "@/lib/challenges";
import type { InputSource } from "@/lib/rhythm-detection";
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
// whole from Home via a single "showChallenges" flag. Deliberately doesn't
// touch app/index.tsx's own state, SyncRecorder, or lib/rhythm-
// detection.ts: every "already validated" piece of logic it needs
// (peak detection, timestamp math, analyzeSession) is reused exactly as
// free mode uses it, just recomposed — see lib/challenges.ts. The one
// exception is inputMode (Mic vs Tap): that's asked once on the setup
// screen, not re-asked here, so Home passes its own choice straight
// through as a prop instead of this file owning a second copy of it.

const ACCENT_COLOR = "#FF3B30";
const SUCCESS_COLOR = "#39FF6A";
const FAIL_COLOR = "#FF453A";
const COUNT_IN_BEATS = 4;

type Phase = "idle" | "countIn" | "recording";

const DIFFICULTY_LABEL: Record<ChallengeDifficulty, string> = {
  facile: "Easy",
  medio: "Medium",
  difficile: "Hard",
  expert: "Expert",
};
const DIFFICULTY_COLOR: Record<ChallengeDifficulty, string> = {
  facile: SUCCESS_COLOR,
  medio: "#FF9F0A",
  difficile: FAIL_COLOR,
  expert: "#BF5AF2",
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
  // Mic vs Tap — chosen once on the free-session setup screen (see
  // components/session-setup.tsx) and passed straight through here rather
  // than asked again: no separate Challenge-only toggle anymore.
  inputMode: InputSource;
};

export default function ChallengeScreen({ onBack, inputMode }: ChallengeScreenProps) {
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<ChallengeId>>(new Set());
  // Replaying the achievement screen on demand (from the list, once every
  // challenge is complete) is independent of the one-time auto-celebration
  // in ChallengeSession/markAllChallengesAchievementSeen — this can be
  // opened and closed as many times as the player likes.
  const [showMasteryReplay, setShowMasteryReplay] = useState(false);

  // Re-read on mount and every time we're back on the list (including
  // right after finishing a session) — a fresh read from storage is the
  // simplest way to pick up a challenge that was just marked completed,
  // without needing a second "did it just pass" channel back up from
  // ChallengeSession.
  useEffect(() => {
    if (activeChallenge) return;
    let cancelled = false;
    getCompletedChallengeIds().then((ids) => {
      if (!cancelled) setCompletedIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [activeChallenge]);

  if (showMasteryReplay) {
    return <TimingMasterScreen onClose={() => setShowMasteryReplay(false)} />;
  }

  if (activeChallenge) {
    return (
      <ChallengeSession
        challenge={activeChallenge}
        inputMode={inputMode}
        onBack={() => setActiveChallenge(null)}
      />
    );
  }

  return (
    <ChallengeList
      completedIds={completedIds}
      onSelect={setActiveChallenge}
      onViewMastery={() => setShowMasteryReplay(true)}
      onBack={onBack}
    />
  );
}

// Scrollable list, ordered easiest to hardest (see CHALLENGES) — only one
// real entry today, but laid out to hold more without changes.
function ChallengeList({
  completedIds,
  onSelect,
  onViewMastery,
  onBack,
}: {
  completedIds: Set<ChallengeId>;
  onSelect: (challenge: Challenge) => void;
  onViewMastery: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const allComplete = CHALLENGES.every((c) => completedIds.has(c.id));

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

        {allComplete && (
          <Pressable onPress={onViewMastery} className="active:opacity-70">
            <DarkPanel
              className="px-4 py-3.5 flex-row items-center justify-between"
              style={{ borderColor: "rgba(255,59,48,0.35)" }}
            >
              <View className="flex-row items-center gap-2.5">
                <Text style={{ fontSize: 18 }}>🏆</Text>
                <Text className="text-white text-sm font-bold">
                  You're a Timing Master
                </Text>
              </View>
              <Text
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: ACCENT_COLOR }}
              >
                View
              </Text>
            </DarkPanel>
          </Pressable>
        )}

        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />

        {CHALLENGES.map((challenge) => (
          <Pressable
            key={challenge.id}
            onPress={() => onSelect(challenge)}
            className="active:opacity-70"
          >
            <DarkPanel className="px-4 py-4 gap-2">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2 flex-1 pr-2">
                  {completedIds.has(challenge.id) && (
                    <Text style={{ color: SUCCESS_COLOR }}>✓</Text>
                  )}
                  <Text className="text-white text-base font-bold flex-shrink">
                    {challenge.name}
                  </Text>
                </View>
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
  inputMode,
  onBack,
}: {
  challenge: Challenge;
  inputMode: InputSource;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [bpm, setBpm] = useState(90);
  const [phase, setPhase] = useState<Phase>("idle");
  const [countInBeat, setCountInBeat] = useState<number | null>(null);
  const [result, setResult] = useState<ChallengeResult | null>(null);
  // Set once handleSessionEnd finds this pass was the one that completed
  // every challenge for the first time — read by the report's onExit below
  // to show TimingMasterScreen instead of leaving straight back to the list.
  const [masteryPending, setMasteryPending] = useState(false);
  const [showMastery, setShowMastery] = useState(false);

  const phaseRef = useRef<Phase>("idle");
  // Guards handleStart/handleStop against a double-tap firing both before
  // the first tap's setPhase has re-rendered the Pressable onto the other
  // handler — without this, two rapid taps can both read the same "idle"
  // (or same "recording") moment and issue two concurrent start()/stop()
  // calls to the native engine.
  const togglingRef = useRef(false);

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
    if (togglingRef.current) return;
    togglingRef.current = true;
    try {
      setResult(null);
      setCountInBeat(null);
      setPhase("countIn");
      await start(bpm);
    } finally {
      togglingRef.current = false;
    }
  };

  const handleStop = async () => {
    if (togglingRef.current) return;
    togglingRef.current = true;
    try {
      await stop();
      setPhase("idle");
      setCountInBeat(null);
    } finally {
      togglingRef.current = false;
    }
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

  // The 8-hit pass/fail verdict comes entirely from re-analyzing either the
  // raw waveform SyncRecorder just recorded (scoreChallenge) or the raw tap
  // timestamps TapRecorder just recorded (scoreChallengeFromTaps) — which
  // one ran is read straight off the summary itself (inputSource), not off
  // this component's own inputMode state, so this stays correct even if a
  // report is ever re-derived from an already-finished summary later. The
  // fixed subdivision="quarter" passed to both recorders below is only ever
  // used for their own (here unused) live approximate status flash, never
  // for this result.
  const handleSessionEnd = async (summary: SessionSummary) => {
    const scored =
      summary.inputSource === "tap"
        ? scoreChallengeFromTaps(challenge, summary.tapTimesMs ?? [], summary.bpm)
        : scoreChallenge(challenge, summary.waveform, summary.bpm, summary.leadInMs);
    setResult(scored);
    if (scored.passed) {
      await markChallengeCompleted(challenge.id);
      const completedIds = await getCompletedChallengeIds();
      const allComplete = CHALLENGES.every((c) => completedIds.has(c.id));
      if (allComplete && !(await hasSeenAllChallengesAchievement())) {
        setMasteryPending(true);
      }
    }
  };

  const isCountIn = phase === "countIn";

  if (showMastery) {
    return (
      <TimingMasterScreen
        onClose={async () => {
          await markAllChallengesAchievementSeen();
          setShowMastery(false);
          setMasteryPending(false);
          setResult(null);
          onBack();
        }}
      />
    );
  }

  if (result) {
    return (
      <ChallengeReport
        result={result}
        onRetry={() => setResult(null)}
        onExit={() => {
          if (masteryPending) {
            setShowMastery(true);
          } else {
            onBack();
          }
        }}
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
        className="flex-1 px-5 justify-between gap-6"
        style={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 48 }}>
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
          {/* Challenge names vary a lot in length (e.g. "Downbeat → Upbeat
              → 3rd Triplet") — wraps up to 2 lines and shrinks itself
              rather than overflowing past the screen edge or the back
              button. */}
          <Text
            className="text-center text-base font-extrabold uppercase tracking-[2px]"
            style={{ color: ACCENT_COLOR }}
            numberOfLines={2}
            adjustsFontSizeToFit
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

        {phase !== "idle" && <BeatIndicator isActive />}

        {inputMode === "tap" ? (
          <>
            <View className="items-center">
              <Text className="text-7xl font-bold text-white">{bpm}</Text>
              <Text
                className="text-xs font-bold tracking-widest mt-1"
                style={{ color: ACCENT_COLOR }}
              >
                BPM
              </Text>
            </View>

            {/* Stays mounted (just disabled once armed) — same as the
                Microphone branch below and as app/index.tsx's own tap
                screen. Unmounting it exactly when a tap arms the recorder
                risked tearing down its gesture/reanimated state mid-
                transition. */}
            <TempoRuler bpm={bpm} onChange={applyBpm} disabled={phase !== "idle"} />

            <View style={{ flex: 1 }}>
              <TapRecorder
                isArmed={phase !== "idle"}
                countInBeats={COUNT_IN_BEATS}
                bpm={bpm}
                subdivision="quarter"
                toleranceMs={challenge.toleranceMs}
                maxBars={challengeBars(challenge)}
                onSessionEnd={handleSessionEnd}
                onRecordingStart={handleRecordingStart}
                onLimitReached={handleLimitReached}
                onRequestStart={handleStart}
              />
            </View>
          </>
        ) : (
          <>
            <SyncRecorder
              isArmed={phase !== "idle"}
              countInBeats={COUNT_IN_BEATS}
              bpm={bpm}
              subdivision="quarter"
              toleranceMs={challenge.toleranceMs}
              maxBars={challengeBars(challenge)}
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

            <TempoRuler bpm={bpm} onChange={applyBpm} disabled={phase !== "idle"} />

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
          </>
        )}
      </View>
    </LinearGradient>
  );
}

// A pass/fail verdict plus which expected hits were on time, followed by a
// Timing Analysis section reusing SessionReport's own DebugChart — one
// instance per analyzeSession call scoreChallenge actually made (see
// ChallengeDebugGroup in lib/challenges.ts), since a challenge almost always
// mixes more than one subdivision across its bars and a single chart can't
// show more than one subdivision's grid at once.
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
          // Clears the back-arrow button above (top: insets.top + 12, 40pt
          // tall) instead of the report's own headline panel starting right
          // underneath/behind it.
          paddingTop: insets.top + 68,
          paddingBottom: insets.bottom + 40,
          gap: 20,
        }}
      >
        <DarkPanel className="px-4 py-6 gap-3 w-full items-center">
          <Text
            className="text-4xl font-bold text-center"
            style={{ color }}
          >
            {result.passed ? "You crushed it!" : "Not quite!"}
          </Text>
          <Text className="text-white/60 text-sm text-center">
            {result.passed
              ? `All ${result.hits.length} hits were on time.`
              : "Not all hits were on time — try again!"}
          </Text>
          <Text className="text-white/40 text-xs font-semibold mt-1">
            {onTimeCount} of {result.hits.length} on time
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
              <View className="flex-row items-center gap-2">
                <Text
                  className="text-xs font-semibold"
                  style={{ color: hit.onTime ? SUCCESS_COLOR : FAIL_COLOR }}
                >
                  {hit.deltaMs === null
                    ? "missed"
                    : `${hit.deltaMs > 0 ? "+" : ""}${Math.round(hit.deltaMs)}ms`}
                </Text>
                <Text
                  className="text-sm font-bold"
                  style={{ color: hit.onTime ? SUCCESS_COLOR : FAIL_COLOR }}
                >
                  {hit.onTime ? "✓" : "✗"}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <DarkPanel className="px-4 py-4 gap-4 w-full">
          <Text
            className="text-[11px] font-bold uppercase tracking-[2px]"
            style={{ color: ACCENT_COLOR }}
          >
            Timing Analysis
          </Text>
          {result.debugGroups.map((group, i) => (
            <View key={`${group.label}-${group.barIndex}-${i}`} className="gap-2">
              <Text className="text-white text-[10px] font-bold uppercase tracking-widest">
                Bar {group.barIndex + 1} — {group.label}
              </Text>
              <DebugChart
                summary={group.summary}
                showDescription={i === 0}
                showRowLabel={false}
              />
            </View>
          ))}
        </DarkPanel>

        <Pressable
          onPress={result.passed ? onExit : onRetry}
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
            {result.passed ? "Go back" : "Retry"}
          </Text>
        </Pressable>
      </ScrollView>
    </LinearGradient>
  );
}
