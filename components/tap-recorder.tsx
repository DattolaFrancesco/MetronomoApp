import DarkPanel from "@/components/dark-panel";
import {
  analyzeTapSession,
  BEATS_PER_BAR,
  classifyOnset,
  currentWindowHalfMs,
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
import { Animated, Pressable, Text } from "react-native";

// Same hold duration SyncRecorder's own live status flash uses — kept
// separate (not imported) since it's a tiny, purely cosmetic constant, not
// part of the shared comparison logic.
const STATUS_HOLD_MS = 180;
const ACCENT_COLOR = "#FF3B30";
const FLASH_DURATION_MS = 260;

// Created once at module scope (not per-render) — Animated.createAnimatedComponent
// wraps Pressable so its style can carry live Animated.Value-driven colors/shadow.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  // Fired instead of handleTap when the button is pressed while not armed
  // yet — lets the caller start the metronome/count-in from the very same
  // press that will, once armed, start registering real taps. Optional so
  // a caller that still drives its own separate Start button (see
  // components/challenge-screen.tsx) keeps working unchanged: with no
  // handler, an idle press just flashes and does nothing else.
  onRequestStart?: () => void;
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
  onRequestStart,
}: TapRecorderProps) {
  const [tapCount, setTapCount] = useState(0);
  // Drives the button's flash/glow: snapped to 1 on every press (armed or
  // not, scored or not — always the same red, no accuracy color-coding),
  // then animated back down to 0 — see triggerFlash below. useState (not
  // useRef) for the Animated.Value itself — same pattern session-setup.tsx's
  // Carousel already uses, since interpolating it directly in the style
  // below needs it to be a plain render-safe value, not a ref.
  const [flashAnim] = useState(() => new Animated.Value(0));

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
  const onRequestStartRef = useRef(onRequestStart);

  // "Beat 1" timestamp — elapsedMs=0 for every tap timestamp recorded
  // below, same role as SyncRecorder's own sessionStartRef.
  const sessionStartRef = useRef<number | null>(null);
  const recordingStartedRef = useRef(false);
  const recordingStartBeatRef = useRef<number | null>(null);
  // True from the count-in's last beat onward (see maybeArmCapture) — one
  // beat *before* recordingStartedRef flips, mirroring SyncRecorder's own
  // audio-pipeline lead-in. Without this, a tap thrown slightly early for
  // beat 1 (completely normal — matchRadius already tolerates an early hit
  // once it's recorded, see matchTapsToExpectedHits) would land before
  // recordingStartedRef ever goes true and be silently dropped instead of
  // scored, systematically costing beat 1's own evaluated hit.
  const captureArmedRef = useRef(false);
  // Raw Date.now() timestamps for taps pressed after captureArmedRef but
  // before sessionStartRef is known (i.e. during the count-in's last beat)
  // — flushed into tapTimesRef as negative (before beat 1) elapsedMs values
  // the moment maybeStartTrackedSession learns the real session start.
  const pendingEarlyTapTimesRef = useRef<number[]>([]);
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
  useEffect(() => {
    onRequestStartRef.current = onRequestStart;
  }, [onRequestStart]);

  function currentBeatIntervalMs() {
    return 60000 / bpmRef.current;
  }

  // Arms tap capture one beat *before* the tracked session actually starts
  // — see captureArmedRef. Idempotent, same guard shape as SyncRecorder's
  // maybeStartAudioPipeline.
  function maybeArmCapture(beat: number) {
    if (!isArmedRef.current || captureArmedRef.current) return;
    const leadInBeat = Math.max(0, countInBeatsRef.current - 1);
    if (beat < leadInBeat) return;
    captureArmedRef.current = true;
  }

  // Flips on the tracked session — this is "beat 1". Unlike SyncRecorder's
  // maybeStartAudioPipeline there's no recorder/mic startup latency to
  // absorb, so the *session clock* (elapsedMs=0) still starts exactly on
  // the beat the count-in elapses — only tap *capture* itself is armed a
  // beat early (see maybeArmCapture/captureArmedRef), so an early tap gets
  // timestamped instead of dropped. Any such tap already sitting in
  // pendingEarlyTapTimesRef gets flushed here into tapTimesRef, now that
  // the real session start is finally known.
  function maybeStartTrackedSession(beat: number, now: number) {
    if (!isArmedRef.current || recordingStartedRef.current) return;
    if (beat < countInBeatsRef.current) return;

    recordingStartedRef.current = true;
    recordingStartBeatRef.current = beat;
    sessionStartRef.current = now;

    if (pendingEarlyTapTimesRef.current.length) {
      for (const tapTime of pendingEarlyTapTimesRef.current) {
        tapTimesRef.current.push(tapTime - now);
      }
      pendingEarlyTapTimesRef.current = [];
    }

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

        maybeArmCapture(beat);
        maybeStartTrackedSession(beat, now);
      },
    );
    return () => subscription.remove();
  }, []);

  // Every press flashes, regardless of whether it ends up scored — this is
  // what makes the button feel responsive even during the count-in (before
  // recordingStartedRef flips true) or on the very first press (which only
  // starts the metronome, see handlePress below). Always the same red flash
  // — no accuracy color-coding (that's what the live status readout and the
  // Timing Analysis report are for).
  function triggerFlash() {
    flashAnim.stopAnimation();
    flashAnim.setValue(1);
    Animated.timing(flashAnim, {
      toValue: 0,
      duration: FLASH_DURATION_MS,
      useNativeDriver: false,
    }).start();
  }

  // The button's single onPress handler. While not armed yet, a press means
  // "start" (see onRequestStart above) rather than a scored hit; once armed
  // (count-in running or recording), it registers a tap — which itself
  // still no-ops (after flashing) until the count-in's last beat has
  // elapsed, i.e. captureArmedRef is true (see maybeArmCapture). Kept as
  // one function (not split into a separate handleTap called from here) so
  // it stays the direct, provably event-only entry point for every
  // Date.now()/ref read below.
  //
  // The click itself comes from expo-precision-metronome's own native
  // engine (see its MetronomeEngine.requestTapClick/renderTapClick), not a
  // second JS-side audio player — an earlier attempt at the latter fought
  // the metronome's engine over the shared iOS audio session and stopped
  // it dead after a couple of beats. Routed through the same engine, the
  // tap click just mixes into the same buffer as the beat click. It's a
  // fire-and-forget call: harmless (silently a no-op) if the engine isn't
  // running yet, e.g. the very first press, which starts it.
  function handlePress() {
    triggerFlash();
    ExpoPrecisionMetronomeModule.playTapClick();

    if (!isArmedRef.current) {
      onRequestStartRef.current?.();
      return;
    }
    // Too early even for the lead-in beat (still mid count-in) — nothing
    // meaningful to record yet.
    if (!captureArmedRef.current) {
      return;
    }

    const now = Date.now();
    if (sessionStartRef.current !== null) {
      tapTimesRef.current.push(now - sessionStartRef.current);
    } else {
      // Lead-in beat: beat 1 (and the session's own start timestamp)
      // hasn't fired yet — queued and converted to a real (negative)
      // elapsedMs by maybeStartTrackedSession once it has.
      pendingEarlyTapTimesRef.current.push(now);
    }
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
          // A tap pressed during the count-in's last beat (see
          // captureArmedRef) can land before elapsedMs=0 — same tempo-
          // adaptive margin as SyncRecorder's own leadInMs, and the same
          // formula DebugChart already uses for its "after the last beat"
          // margin, so the report's first bar has room to actually draw
          // that hit instead of clipping it at the bar's left edge.
          leadInMs: currentWindowHalfMs(60000 / bpmRef.current),
          inputSource: "tap",
          tapTimesMs: [...tapTimesRef.current],
        });

        sessionStartRef.current = null;
      }

      recordingStartedRef.current = false;
      recordingStartBeatRef.current = null;
      captureArmedRef.current = false;
      pendingEarlyTapTimesRef.current = [];
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
    <DarkPanel className="px-4 py-4 gap-3 w-full" style={{ flex: 1 }}>
      <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
        Input tap
      </Text>

      <AnimatedPressable
        onPress={handlePress}
        className="items-center justify-center rounded-2xl active:opacity-80"
        style={{
          flex: 1,
          borderWidth: 2,
          borderColor: ACCENT_COLOR,
          backgroundColor: flashAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ["rgba(255,59,48,0.12)", ACCENT_COLOR],
          }),
          shadowColor: ACCENT_COLOR,
          shadowOpacity: flashAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 0.9],
          }),
          shadowRadius: flashAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 28],
          }),
          shadowOffset: { width: 0, height: 0 },
        }}
      >
        <Text className="text-3xl font-extrabold uppercase tracking-widest text-white">
          Tap
        </Text>
        <Text className="text-white/50 text-sm font-semibold mt-2">
          {tapCount} taps
        </Text>
      </AnimatedPressable>

      <Text className="text-neutral-600 text-xs leading-4">
        {isArmed
          ? "Tap the button in time with the metronome."
          : "Tap the button to start — no microphone needed."}
      </Text>
    </DarkPanel>
  );
}
