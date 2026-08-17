import DarkPanel from "@/components/dark-panel";
import {
  analyzeTapSession,
  BEATS_PER_BAR,
  classifyOnset,
  DEFAULT_TOLERANCE_MS,
  evaluatedSubBeats,
  SUBDIVISION_STEPS,
  type OnsetStatus,
  type SessionSummary,
  type SixteenthTarget,
  type Subdivision,
  type TripletTarget,
} from "@/lib/rhythm-detection";
import ExpoPrecisionMetronomeModule, {
  type BeatEventPayload,
} from "expo-precision-metronome";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";

// Same hold duration SyncRecorder's own live status flash uses — kept
// separate (not imported) since it's a tiny, purely cosmetic constant, not
// part of the shared comparison logic.
const STATUS_HOLD_MS = 180;
const ACCENT_COLOR = "#FF3B30";
const TAP_BUTTON_HEIGHT = 120;

type TapRecorderProps = {
  // Same prop shape as components/sync-recorder.tsx's SyncRecorder — the
  // two are meant to be swapped for each other behind an input-mode
  // toggle without the caller needing separate wiring. See that file for
  // the detailed rationale behind each prop; not repeated here.
  isArmed: boolean;
  countInBeats?: number;
  bpm: number;
  toleranceMs?: number;
  subdivision?: Subdivision;
  tripletTarget?: TripletTarget;
  sixteenthTarget?: SixteenthTarget;
  maxBars?: number;
  onSessionEnd?: (summary: SessionSummary) => void;
  onStatusChange?: (
    status: OnsetStatus | null,
    offsetMs: number | null,
  ) => void;
  onRecordingStart?: () => void;
  onLimitReached?: () => void;
};

// Tap-input counterpart to SyncRecorder — same count-in/auto-stop
// mechanics (driven by the same native metronome onBeat event) and the
// same offline comparison logic (see lib/rhythm-detection.ts's
// analyzeTapSession, which reuses classifyOnset exactly as analyzeSession
// does), but replaces the microphone/peak-detection pipeline with a single
// on-screen button: every press is an exact, unambiguous timestamp, so
// there's no permission, gating, or amplitude-threshold logic to run at
// all. sync-recorder.tsx itself is untouched — this is a fully separate
// component, not a mode flag on it.
export default function TapRecorder({
  isArmed,
  countInBeats = 0,
  bpm,
  toleranceMs = DEFAULT_TOLERANCE_MS,
  subdivision = "quarter",
  tripletTarget = 2,
  sixteenthTarget = 2,
  maxBars,
  onSessionEnd,
  onStatusChange,
  onRecordingStart,
  onLimitReached,
}: TapRecorderProps) {
  const [tapCount, setTapCount] = useState(0);

  const bpmRef = useRef(bpm);
  const toleranceRef = useRef(toleranceMs);
  const subdivisionRef = useRef(subdivision);
  const tripletTargetRef = useRef(tripletTarget);
  const sixteenthTargetRef = useRef(sixteenthTarget);
  const maxBarsRef = useRef(maxBars);
  const countInBeatsRef = useRef(countInBeats);
  const isArmedRef = useRef(isArmed);
  const onSessionEndRef = useRef(onSessionEnd);
  const onStatusChangeRef = useRef(onStatusChange);
  const onRecordingStartRef = useRef(onRecordingStart);
  const onLimitReachedRef = useRef(onLimitReached);

  // "Beat 1" timestamp — elapsedMs=0 for every tap timestamp recorded
  // below, same role as SyncRecorder's own sessionStartRef.
  const sessionStartRef = useRef<number | null>(null);
  const recordingStartedRef = useRef(false);
  const recordingStartBeatRef = useRef<number | null>(null);
  const tapTimesRef = useRef<number[]>([]);
  const lastBeatRef = useRef(-1);
  const lastBeatTimeRef = useRef(0);
  const limitReachedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);
  useEffect(() => {
    toleranceRef.current = toleranceMs;
  }, [toleranceMs]);
  useEffect(() => {
    subdivisionRef.current = subdivision;
  }, [subdivision]);
  useEffect(() => {
    tripletTargetRef.current = tripletTarget;
  }, [tripletTarget]);
  useEffect(() => {
    sixteenthTargetRef.current = sixteenthTarget;
  }, [sixteenthTarget]);
  useEffect(() => {
    maxBarsRef.current = maxBars;
  }, [maxBars]);
  useEffect(() => {
    countInBeatsRef.current = countInBeats;
  }, [countInBeats]);
  useEffect(() => {
    isArmedRef.current = isArmed;
  }, [isArmed]);
  useEffect(() => {
    onSessionEndRef.current = onSessionEnd;
  }, [onSessionEnd]);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);
  useEffect(() => {
    onRecordingStartRef.current = onRecordingStart;
  }, [onRecordingStart]);
  useEffect(() => {
    onLimitReachedRef.current = onLimitReached;
  }, [onLimitReached]);

  function currentBeatIntervalMs() {
    return 60000 / bpmRef.current;
  }

  // Flips on the tracked session — this is "beat 1". No lead-in warm-up
  // needed here (unlike SyncRecorder's maybeStartAudioPipeline): there's no
  // recorder/mic startup latency to absorb, so the tracked session can
  // start exactly on the beat the count-in elapses.
  function maybeStartTrackedSession(beat: number, now: number) {
    if (!isArmedRef.current || recordingStartedRef.current) return;
    if (beat < countInBeatsRef.current) return;

    recordingStartedRef.current = true;
    recordingStartBeatRef.current = beat;
    sessionStartRef.current = now;
    onRecordingStartRef.current?.();
  }

  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onBeat",
      ({ beat }: BeatEventPayload) => {
        const now = Date.now();
        lastBeatRef.current = beat;
        lastBeatTimeRef.current = now;

        // Auto-stop (setup screen's bars count) — same delayed-by-half-a-
        // beat pattern as SyncRecorder's own auto-stop, for the same
        // reason: gives a late final tap (already scheduled but not yet
        // pressed) a little more room before the caller actually tears
        // the engine down.
        if (
          recordingStartedRef.current &&
          maxBarsRef.current != null &&
          recordingStartBeatRef.current !== null &&
          beat - recordingStartBeatRef.current >=
            maxBarsRef.current * BEATS_PER_BAR
        ) {
          if (!limitReachedTimeoutRef.current) {
            limitReachedTimeoutRef.current = setTimeout(() => {
              limitReachedTimeoutRef.current = null;
              onLimitReachedRef.current?.();
            }, currentBeatIntervalMs() / 2);
          }
          return;
        }

        maybeStartTrackedSession(beat, now);
      },
    );
    return () => subscription.remove();
  }, []);

  function handleTap() {
    if (!isArmedRef.current || !recordingStartedRef.current) return;
    if (sessionStartRef.current === null) return;

    const now = Date.now();
    tapTimesRef.current.push(now - sessionStartRef.current);
    setTapCount((c) => c + 1);

    // Live feedback only — the same offline comparison analyzeTapSession
    // runs at teardown (see below) is what the actual report is built
    // from. Classifies this tap against whichever of the current/next
    // beat's own evaluated sub-beat position sits closer to it — unlike
    // SyncRecorder's capture-window approach, a tap has no ambiguity to
    // wait out, so this resolves immediately instead of on a delay.
    const beatIntervalMs = currentBeatIntervalMs();
    const steps = SUBDIVISION_STEPS[subdivisionRef.current];
    const subIntervalMs = beatIntervalMs / steps;
    const sub = evaluatedSubBeats(
      subdivisionRef.current,
      tripletTargetRef.current,
      sixteenthTargetRef.current,
    )[0];

    const currentCandidate = lastBeatTimeRef.current + sub * subIntervalMs;
    const nextCandidate = currentCandidate + beatIntervalMs;
    const candidate =
      Math.abs(now - currentCandidate) <= Math.abs(now - nextCandidate)
        ? currentCandidate
        : nextCandidate;

    const delta = now - candidate;
    const status = classifyOnset(delta, toleranceRef.current);
    onStatusChangeRef.current?.(status, delta);

    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => {
      onStatusChangeRef.current?.(null, null);
    }, STATUS_HOLD_MS);
  }

  useEffect(() => {
    if (!isArmed) return;

    return () => {
      if (limitReachedTimeoutRef.current) {
        clearTimeout(limitReachedTimeoutRef.current);
        limitReachedTimeoutRef.current = null;
      }
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      onStatusChangeRef.current?.(null, null);

      if (sessionStartRef.current !== null) {
        const durationMs = Date.now() - sessionStartRef.current;
        const { events, hitDiagnostics } = analyzeTapSession(
          tapTimesRef.current,
          durationMs,
          bpmRef.current,
          subdivisionRef.current,
          tripletTargetRef.current,
          sixteenthTargetRef.current,
          toleranceRef.current,
          maxBarsRef.current,
        );

        onSessionEndRef.current?.({
          events,
          rejectedPeaks: [],
          hitDiagnostics,
          durationMs,
          toleranceMs: toleranceRef.current,
          bpm: bpmRef.current,
          subdivision: subdivisionRef.current,
          tripletTarget: tripletTargetRef.current,
          sixteenthTarget: sixteenthTargetRef.current,
          waveform: [],
          maxBars: maxBarsRef.current,
          leadInMs: 0,
          inputSource: "tap",
          tapTimesMs: [...tapTimesRef.current],
        });

        sessionStartRef.current = null;
      }

      recordingStartedRef.current = false;
      recordingStartBeatRef.current = null;
      tapTimesRef.current = [];
      lastBeatRef.current = -1;
      setTapCount(0);
    };
  }, [isArmed]);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  return (
    <DarkPanel className="px-4 py-4 gap-3 w-full">
      <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
        Input tap
      </Text>

      <Pressable
        onPress={handleTap}
        disabled={!isArmed}
        className="items-center justify-center rounded-2xl active:opacity-70"
        style={{
          height: TAP_BUTTON_HEIGHT,
          borderWidth: 2,
          borderColor: ACCENT_COLOR,
          backgroundColor: "rgba(255,59,48,0.12)",
          opacity: isArmed ? 1 : 0.4,
        }}
      >
        <Text
          className="text-2xl font-extrabold uppercase tracking-widest"
          style={{ color: ACCENT_COLOR }}
        >
          Tap
        </Text>
        <Text className="text-white/40 text-xs font-semibold mt-1">
          {tapCount} taps
        </Text>
      </Pressable>

      <Text className="text-neutral-600 text-xs leading-4">
        Tap the button in time with the metronome — no microphone needed.
      </Text>
    </DarkPanel>
  );
}
