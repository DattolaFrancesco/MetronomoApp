import DarkPanel from "@/components/dark-panel";
import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import ExpoPrecisionMetronomeModule, {
  type BeatAccent,
  type BeatEventPayload,
} from "expo-precision-metronome";
import { memo, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

export const DEFAULT_TOLERANCE_MS = 120;

// Polling drives both the peak search and the click-gate resolution.
const POLL_INTERVAL_MS = 20;
const HISTORY_SIZE = 70;

const SILENCE_FLOOR_DB = -50;
// Minimum normalized amplitude (0-1 on the SILENCE_FLOOR_DB..0dB scale) for a
// sample to count as a real onset — clearly above a quiet room's background
// noise floor, but low enough that normally-played instruments (e.g. an
// acoustic guitar picked at a moderate, sustained volume, not just sharp
// percussive transients like a handclap) still clear it reliably. Anything
// under this is treated as ambient noise and ignored everywhere (status
// flash, waveform accent, report). Exported so the debug chart can draw it
// as a reference line.
export const MIN_PEAK_AMPLITUDE = 0.3;
// Floor for a sample to be worth surfacing at all in the debug chart's
// rejected-peaks list — well below MIN_PEAK_AMPLITUDE, so genuinely
// near-silent noise-floor jitter still isn't logged (it would just be
// visual spam), but a real, audible-but-too-quiet tap still shows up
// instead of vanishing without a trace.
const DEBUG_CANDIDATE_FLOOR = 0.15;

export const BEATS_PER_BAR = 4;

// Rhythmic subdivision selected on the setup screen — how many equal
// sub-beats each native quarter-note beat is split into for onset-capture
// purposes. The native engine only ever fires onBeat once per quarter, so
// every subdivision beyond "quarter" is purely a JS-side windowing scheme:
// each onBeat opens `steps` evenly-spaced capture windows across that one
// quarter's interval instead of just one. Only "quarter" and "eighth" are
// wired up and selectable in the setup screen for now — "triplet" and
// "sixteenth" are defined here already since the mechanism is identical for
// any step count, but stay disabled in the UI until validated on-device.
export type Subdivision = "quarter" | "eighth" | "triplet" | "sixteenth";
export const SUBDIVISION_STEPS: Record<Subdivision, number> = {
  quarter: 1,
  eighth: 2,
  triplet: 3,
  sixteenth: 4,
};

// Which of the triplet's two off-beat notes (the 2nd or 3rd note of the
// triplet — the 1st always coincides with the quarter/battere, so it's
// never a selectable target) is evaluated when subdivision is "triplet".
// Irrelevant for every other subdivision. 1-indexed as shown to the user
// ("2" / "3"); internally that's sub-beat index 1 or 2 (0 = the quarter).
export type TripletTarget = 2 | 3;

// Which sub-beat indices within each quarter actually get an onset-capture
// window opened. For "quarter" and "sixteenth" this is simply every step
// (0..steps-1). "eighth" and "triplet" are deliberate exceptions: only a
// single chosen off-beat is evaluated — the quarter itself (sub-beat 0,
// "il battere") is skipped entirely, so it never becomes an
// accepted/rejected onset anywhere (report, debug chart). For "eighth" that
// off-beat is fixed (there's only one, "il levare", sub-beat 1); for
// "triplet" it's whichever of the two off-beat notes the user picked on the
// recording screen (see TripletTarget). See beat-indicator.tsx for the
// purely-visual distinction this implies (all sub-beats are still shown
// there, just differently styled).
export function evaluatedSubBeats(
  subdivision: Subdivision,
  tripletTarget: TripletTarget,
): number[] {
  switch (subdivision) {
    case "quarter":
      return [0];
    case "eighth":
      return [1];
    case "triplet":
      return [tripletTarget - 1];
    case "sixteenth":
      return [0, 1, 2, 3];
  }
}

// Which sub-beat is the "primary" (prominent, glowing) marker in
// beat-indicator.tsx. For "quarter" and "sixteenth" this is the native
// quarter itself. "eighth" and "triplet" are exceptions, matching
// evaluatedSubBeats above: since only the chosen off-beat is actually
// judged by peak detection, it's that off-beat that's drawn prominent — the
// quarter (and, for triplets, the other off-beat note) stay visible, just
// demoted to the secondary/outline style.
export function primarySubBeat(
  subdivision: Subdivision,
  tripletTarget: TripletTarget,
): number {
  switch (subdivision) {
    case "quarter":
      return 0;
    case "eighth":
      return 1;
    case "triplet":
      return tripletTarget - 1;
    case "sixteenth":
      return 0;
  }
}

// The peak-capture window around each beat adapts to tempo (40% of the
// beat-to-beat interval each side), clamped to a sane range for very
// slow/fast tempos.
const WINDOW_HALF_RATIO = 0.55;
const WINDOW_HALF_MIN_MS = 60;
const WINDOW_HALF_MAX_MS = 150;
// Hard safety cap: a window may never reach past the midpoint to the next
// beat, otherwise two consecutive beats' windows could overlap at high BPM.
// This wins over the ratio and the min clamp above whenever they'd overlap.
const WINDOW_SAFETY_MARGIN_MS = 6;
const RECENT_SAMPLES_MAX_AGE_MS = 200;
const STATUS_HOLD_MS = 180;

// The mic also picks up the metronome's own click from the phone speaker.
// We know the exact instant the native engine fires each click (the onBeat
// timestamp), so we gate out samples for a short window right after it and
// only resume peak search once the gate has closed. Exported so the debug
// chart can shade exactly the interval actually used at runtime.
export const CLICK_GATE_MS = 18;
// CLICK_GATE_MS alone only covers the click's initial transient — without
// headphones, the mic also picks up its room/speaker decay tail, which can
// stay above MIN_PEAK_AMPLITUDE well past 18ms. Since onset detection locks
// onto the *first* sample that clears the threshold in a window (see
// PendingBeat.onsetTime), that lingering tail can get mistaken for the
// user's real onset if it's still ringing when an evaluated off-beat
// window opens (e.g. eighth's levare) — the window then reports a much
// earlier, wrong onset time instead of the user's actual (later, louder,
// genuinely on-time) hit. So instead of releasing the gate on a fixed
// timer, pollTick (below) keeps sliding it forward in small increments for
// as long as the mic still reads above threshold, and only lets it close
// once the signal has actually dropped back down — capped so persistent
// background noise can't wedge it open indefinitely.
const CLICK_GATE_EXTEND_MS = 20;
const CLICK_GATE_MAX_MS = 80;

// Decimated (bucket-max) amplitude history kept for the full-session
// waveform shown later in the report — far coarser than the 20ms poll rate
// so a long session doesn't balloon memory, while still keeping each
// bucket's loudest sample so transient hits stay visible.
export const WAVEFORM_SAMPLE_INTERVAL_MS = 50;

const MAX_BAR_HEIGHT = 64;
const WAVEFORM_PANEL_HEIGHT = 80;
const BAR_COLOR = "#39FF6A";

export type OnsetStatus = "onTime" | "early" | "late";

export type OnsetEvent = {
  id: number;
  elapsedMs: number;
  deltaMs: number;
  status: OnsetStatus;
  beatIndex: number;
  // Which sub-beat within that quarter this is (0 for the quarter itself,
  // 1..steps-1 for the subdivisions in between) — 0 always when
  // subdivision is "quarter". See Subdivision/SUBDIVISION_STEPS.
  subBeatIndex: number;
  // Normalized (0-1) amplitude of the accepted onset sample — debug-chart
  // only (not shown in the main user-facing report).
  amplitude: number;
};

// Why a candidate peak inside a beat's capture window never became an
// accepted OnsetEvent. "clickMatch" is reserved for a spectral/envelope
// template-match rejection layer (compares the candidate against a known
// click "signature") that isn't wired into this build's detection pipeline
// right now — it's kept here so the debug chart already has a slot ready
// for it, but nothing currently ever produces it.
export type PeakRejectReason = "belowThreshold" | "gated" | "clickMatch";

export type RejectedPeak = {
  id: number;
  elapsedMs: number;
  amplitude: number;
  reason: PeakRejectReason;
  beatIndex: number;
  subBeatIndex: number;
  // Signed offset from the beat this peak's window belonged to (negative =
  // before the beat, positive = after) — same convention as OnsetEvent.deltaMs.
  deltaMs: number;
};

export type SessionSummary = {
  events: OnsetEvent[];
  // Every candidate peak that had a beat's capture window open but didn't
  // end up accepted — debug-chart only. See RejectedPeak/PeakRejectReason.
  rejectedPeaks: RejectedPeak[];
  durationMs: number;
  toleranceMs: number;
  // BPM the session was recorded at — debug-chart only, needed to redraw
  // the expected quarter/eighth beat grid against the raw waveform.
  bpm: number;
  // Rhythmic subdivision the session was recorded at (see Subdivision) —
  // determines how many onset-capture windows exist per quarter beat.
  subdivision: Subdivision;
  // Which triplet note was the evaluation target (see TripletTarget) —
  // meaningless when subdivision isn't "triplet", but always present so
  // consumers don't need to special-case its absence.
  tripletTarget: TripletTarget;
  // Decimated amplitude history for the whole session, one entry per
  // WAVEFORM_SAMPLE_INTERVAL_MS bucket, for drawing the static full-session
  // waveform in the report. Index i covers [i, i+1) * WAVEFORM_SAMPLE_INTERVAL_MS
  // elapsed ms, same time base as OnsetEvent.elapsedMs.
  waveform: number[];
};

type PendingBeat = {
  beatIndex: number;
  subBeatIndex: number;
  beatTime: number;
  windowStart: number;
  windowEnd: number;
  // Timestamp of the *first* sample in this window that cleared
  // MIN_PEAK_AMPLITUDE, or null if none has yet. Deliberately not "the
  // loudest sample seen" — a sustained instrument (e.g. a plucked guitar
  // string) can keep growing louder well after the true attack, which would
  // otherwise report the onset later than it actually was.
  onsetTime: number | null;
  // Amplitude at onsetTime, captured at the same instant onsetTime is set —
  // debug-chart only (OnsetEvent.amplitude).
  onsetAmp: number | null;
  // Loudest sample seen anywhere in this window, gated or not — the only
  // way a gated-away hit (which never touches recentSamplesRef at all) is
  // still visible to the debug chart once the window closes. Also doubles
  // as the "belowThreshold" amplitude when nothing here ever reached
  // MIN_PEAK_AMPLITUDE.
  peakAmp: number;
  peakTime: number | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Module-level (not just a component-local closure) so both the live
// per-beat pipeline (approximate status banner) and analyzeSession's
// offline pass (the report's actual events/rejectedPeaks) size their
// capture windows identically, off the same formula.
function currentWindowHalfMs(beatIntervalMs: number) {
  const ratioBased = clamp(
    beatIntervalMs * WINDOW_HALF_RATIO,
    WINDOW_HALF_MIN_MS,
    WINDOW_HALF_MAX_MS,
  );
  const safetyCap = beatIntervalMs / 2 - WINDOW_SAFETY_MARGIN_MS;
  return Math.max(10, Math.min(ratioBased, safetyCap));
}

type WaveformBarProps = {
  index: number;
  amplitudes: SharedValue<number[]>;
  accents: SharedValue<(BeatAccent | null)[]>;
};

// Reads straight from shared values so a new audio sample never triggers a
// React re-render — only a UI-thread style recompute for these 70 bars.
const WaveformBar = memo(function WaveformBar({
  index,
  amplitudes,
  accents,
}: WaveformBarProps) {
  const barStyle = useAnimatedStyle(() => ({
    height: Math.max(2, amplitudes.value[index] * MAX_BAR_HEIGHT),
  }));

  const accentStyle = useAnimatedStyle(() => {
    const accent = accents.value[index];
    return {
      opacity: accent === "strong" ? 0.9 : accent ? 0.45 : 0,
      backgroundColor: accent === "strong" ? "#FF9F0A" : "#FFD60A",
    };
  });

  return (
    <View
      className="flex-1 mx-px items-center justify-end"
      style={{ height: MAX_BAR_HEIGHT }}
    >
      <Animated.View
        className="absolute bottom-0 w-[2px] rounded-full"
        style={[{ height: MAX_BAR_HEIGHT }, accentStyle]}
      />
      <Animated.View
        className="w-full rounded-full"
        style={[{ backgroundColor: BAR_COLOR }, barStyle]}
      />
    </View>
  );
});

// How far past a click analyzeSession keeps scanning for where its own
// decay actually ends (see clickDecayEnds below) before giving up and
// capping it — a safety bound, not a guess at the real duration, since the
// real duration is measured directly from the recorded samples.
const CLICK_DECAY_MAX_MS = 150;

// Post-hoc peak analysis: run once at teardown over the complete raw
// amplitude log collected during the session (see rawSamplesRef), instead
// of trying to classify each hit live, in real time, as it happens. With
// the whole recording already in hand there's no need for a live
// threshold/gate/rising-edge to guess "was that the user's hit or click
// residue" — the actual tallest peak near each expected beat position can
// just be looked up directly, exactly like what the debug chart's waveform
// bars already show. The live pipeline in the component below still runs
// in parallel purely to drive the approximate real-time status banner —
// this function is the sole source of the report's events/rejectedPeaks.
function analyzeSession(
  rawSamples: { time: number; amp: number }[],
  durationMs: number,
  bpm: number,
  subdivision: Subdivision,
  tripletTarget: TripletTarget,
  toleranceMs: number,
): { events: OnsetEvent[]; rejectedPeaks: RejectedPeak[] } {
  const events: OnsetEvent[] = [];
  const rejectedPeaks: RejectedPeak[] = [];

  const beatIntervalMs = 60000 / bpm;
  if (
    !Number.isFinite(beatIntervalMs) ||
    beatIntervalMs <= 0 ||
    rawSamples.length === 0
  ) {
    return { events, rejectedPeaks };
  }

  const steps = SUBDIVISION_STEPS[subdivision];
  const subIntervalMs = beatIntervalMs / steps;
  const windowHalf = currentWindowHalfMs(subIntervalMs);
  const totalQuarters = Math.ceil(durationMs / beatIntervalMs) + 1;

  // Every click's own decay end, found directly in the data instead of
  // guessed with a fixed or extending timer: the first sample after each
  // click where the level has actually dropped back below
  // MIN_PEAK_AMPLITUDE. Excluding samples inside these spans from the peak
  // search below is what stops the click's own room/speaker decay from
  // ever being mistaken for the user's hit, regardless of how long it
  // happens to ring in a given room.
  const clickDecayEnds: number[] = [];
  for (let i = 0; i < totalQuarters; i++) {
    const clickTime = i * beatIntervalMs;
    let decayEnd = clickTime + CLICK_DECAY_MAX_MS;
    for (const sample of rawSamples) {
      if (sample.time < clickTime) continue;
      if (sample.time > clickTime + CLICK_DECAY_MAX_MS) break;
      if (sample.amp < MIN_PEAK_AMPLITUDE) {
        decayEnd = sample.time;
        break;
      }
    }
    clickDecayEnds.push(decayEnd);
  }
  const isClickResidue = (time: number) => {
    const nearestBeat = Math.round(time / beatIntervalMs);
    for (const i of [nearestBeat - 1, nearestBeat, nearestBeat + 1]) {
      if (i < 0 || i >= clickDecayEnds.length) continue;
      const clickTime = i * beatIntervalMs;
      if (time >= clickTime && time <= clickDecayEnds[i]) return true;
    }
    return false;
  };

  let eventId = 0;
  let rejectedId = 0;

  for (let i = 0; i < totalQuarters; i++) {
    const beatTime = i * beatIntervalMs;
    const beatIndex = i % BEATS_PER_BAR;
    for (const sub of evaluatedSubBeats(subdivision, tripletTarget)) {
      const targetTime = beatTime + sub * subIntervalMs;
      if (targetTime > durationMs + beatIntervalMs) continue;
      const windowStart = targetTime - windowHalf;
      const windowEnd = targetTime + windowHalf;

      let bestAmp = 0;
      let bestTime: number | null = null;
      let rawBestAmp = 0;
      let rawBestTime: number | null = null;
      for (const sample of rawSamples) {
        if (sample.time < windowStart || sample.time > windowEnd) continue;
        if (sample.amp > rawBestAmp) {
          rawBestAmp = sample.amp;
          rawBestTime = sample.time;
        }
        if (isClickResidue(sample.time)) continue;
        if (sample.amp > bestAmp) {
          bestAmp = sample.amp;
          bestTime = sample.time;
        }
      }

      if (bestTime !== null && bestAmp >= MIN_PEAK_AMPLITUDE) {
        const delta = bestTime - targetTime;
        const inTime = Math.abs(delta) <= toleranceMs;
        const status: OnsetStatus = inTime
          ? "onTime"
          : delta < 0
            ? "early"
            : "late";
        events.push({
          id: eventId++,
          elapsedMs: targetTime,
          deltaMs: delta,
          status,
          beatIndex,
          subBeatIndex: sub,
          amplitude: bestAmp,
        });
      } else if (rawBestTime !== null && rawBestAmp >= DEBUG_CANDIDATE_FLOOR) {
        // Nothing outside a click's own decay cleared the threshold — if
        // the window's true (unfiltered) peak did clear it, log that it
        // was excluded as click residue instead of silently dropping it;
        // otherwise it's a genuine near-miss below the acceptance floor.
        const reason: PeakRejectReason =
          rawBestAmp >= MIN_PEAK_AMPLITUDE ? "gated" : "belowThreshold";
        rejectedPeaks.push({
          id: rejectedId++,
          elapsedMs: rawBestTime,
          amplitude: rawBestAmp,
          reason,
          beatIndex,
          subBeatIndex: sub,
          deltaMs: rawBestTime - targetTime,
        });
      }
    }
  }

  return { events, rejectedPeaks };
}

type SyncRecorderProps = {
  // True for the whole armed lifecycle: mic permission/prep starts
  // immediately (e.g. from the start of a count-in), and real recording
  // begins automatically once countInBeats have played — see countInBeats.
  // Going false tears everything down (stop, fire onSessionEnd if a real
  // recording had started).
  isArmed: boolean;
  // How many native beats (since the engine's own start()) to let play
  // silently before real recording begins — 0 starts on the first beat
  // received while armed. The transition happens synchronously inside this
  // component's own onBeat handler, not via a prop flip on a later render,
  // so the exact beat that ends the count-in isn't missed: routing it
  // through React state would start the recorder and its poll loop one or
  // more render cycles late, after that beat's audio had already passed.
  countInBeats?: number;
  bpm: number;
  toleranceMs?: number;
  // Rhythmic subdivision chosen on the setup screen — defaults to plain
  // quarters (one capture window per native beat, the original behavior).
  subdivision?: Subdivision;
  // Which triplet note (2nd or 3rd) to evaluate when subdivision is
  // "triplet" — chosen on the recording screen, not the setup step. Ignored
  // for every other subdivision.
  tripletTarget?: TripletTarget;
  // Fixed number of bars to auto-stop after (chosen on the setup screen).
  // Undefined means no auto-stop — the caller must stop manually. This is a
  // behavior change from the previous unlimited-until-Stop session: when
  // set, the session now always ends itself after exactly this many bars.
  maxBars?: number;
  onSessionEnd?: (summary: SessionSummary) => void;
  onStatusChange?: (
    status: OnsetStatus | null,
    offsetMs: number | null,
  ) => void;
  // Fired synchronously the instant real recording begins, purely so the
  // caller can update its own UI (e.g. swap a count-in display for a
  // status label) — not on the audio-timing critical path.
  onRecordingStart?: () => void;
  // Fired synchronously, exactly once, the instant maxBars worth of native
  // beats have elapsed since recording started. This component only tracks
  // beats/audio — it has no handle on the native engine's start()/stop(),
  // so the caller is responsible for actually stopping it (and flipping
  // isArmed false, which is what triggers onSessionEnd below). Manual stop
  // (the caller flipping isArmed false itself, e.g. a Stop button) still
  // works at any time regardless of maxBars — this only adds an automatic
  // trigger for the same teardown path, it doesn't replace manual stop.
  onLimitReached?: () => void;
};

export default function SyncRecorder({
  isArmed,
  countInBeats = 0,
  bpm,
  toleranceMs = DEFAULT_TOLERANCE_MS,
  subdivision = "quarter",
  tripletTarget = 2,
  maxBars,
  onSessionEnd,
  onStatusChange,
  onRecordingStart,
  onLimitReached,
}: SyncRecorderProps) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  const [permissionDenied, setPermissionDenied] = useState(false);

  const amplitudesSV = useSharedValue<number[]>(
    new Array(HISTORY_SIZE).fill(0),
  );
  const accentsSV = useSharedValue<(BeatAccent | null)[]>(
    new Array(HISTORY_SIZE).fill(null),
  );

  const toleranceRef = useRef(toleranceMs);
  const bpmRef = useRef(bpm);
  const subdivisionRef = useRef(subdivision);
  const tripletTargetRef = useRef(tripletTarget);
  const maxBarsRef = useRef(maxBars);
  const onLimitReachedRef = useRef(onLimitReached);
  // Native beat number (since the engine's own start()) of the beat that
  // started the tracked session — lets the onBeat handler compute "how many
  // beats into the session are we" without any extra counter of its own.
  const recordingStartBeatRef = useRef<number | null>(null);
  const pendingBeatRef = useRef<BeatAccent | null>(null);

  // Rolling short history of recent samples, so the peak search opened by a
  // point can also look slightly *before* its expected timestamp (an "early" hit).
  // Samples inside an active click gate are never added here, so they can
  // never be picked up by any window's peak search, past or future.
  // `risingEdge` marks samples where the mic level just crossed *up* through
  // MIN_PEAK_AMPLITUDE (see wasAboveThresholdRef) — only these count as a
  // genuine onset. A sample that's merely still above threshold from
  // earlier is the tail of whatever caused that (the click's own decay, a
  // previous note ringing out, room reverb...) and must not be mistaken for
  // a new hit just because it hasn't faded below the floor yet.
  const recentSamplesRef = useRef<
    { time: number; amp: number; risingEdge: boolean }[]
  >([]);
  // Whether the last poll's amplitude was already above MIN_PEAK_AMPLITUDE —
  // tracked every tick regardless of gating, so the rising-edge check stays
  // correct across a gate boundary too (a sample right after the gate lifts
  // must not count as "rising" if the level never actually dropped below
  // threshold while gated).
  const wasAboveThresholdRef = useRef(false);
  const pendingBeatsRef = useRef<PendingBeat[]>([]);
  const gatedUntilRef = useRef(0);
  // When the current click gate was first armed (the click's own onBeat
  // timestamp) — bounds how far pollTick is allowed to keep sliding
  // gatedUntilRef forward (see CLICK_GATE_MAX_MS).
  const gateArmedAtRef = useRef(0);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionStartRef = useRef<number | null>(null);
  // Full-resolution (one entry per poll tick, ~20ms) raw amplitude log for
  // the tracked session, elapsed-ms-from-sessionStart timestamps — the
  // source of truth analyzeSession() replays once at teardown to build the
  // report's events/rejectedPeaks, instead of trying to classify each hit
  // live as it happens. Separate from waveformRef below, which is a
  // coarser (50ms bucket-max) decimation kept only for the report's visual
  // waveform bars — too lossy on timing to drive classification itself.
  const rawSamplesRef = useRef<{ time: number; amp: number }[]>([]);
  const waveformRef = useRef<number[]>([]);
  const waveformBucketIndexRef = useRef(-1);
  const waveformBucketMaxRef = useRef(0);
  const onSessionEndRef = useRef(onSessionEnd);
  const onStatusChangeRef = useRef(onStatusChange);
  const onRecordingStartRef = useRef(onRecordingStart);

  // Mirrors of props read from inside the onBeat handler, which is
  // registered once (empty dep array) so it never sees stale prop values
  // through its own closure.
  const isArmedRef = useRef(isArmed);
  const countInBeatsRef = useRef(countInBeats);
  // Whether prepareToRecordAsync has resolved — the onBeat handler must not
  // call recorder.record() before this, even if the count-in has elapsed.
  const preparedRef = useRef(false);
  // Whether the mic is actually recording yet (recorder.record() + poll
  // loop) — flips one beat *before* the tracked session starts, so the
  // recorder is already warmed up and sampling by the time the real first
  // beat's peak-capture window opens. See maybeStartAudioPipeline.
  const audioStartedRef = useRef(false);
  // Whether the tracked session (sessionStartRef, elapsedMs, the report)
  // has begun — this is the actual "beat 1" moment, one beat after audio
  // started. So the count-in threshold can only ever fire it once.
  const recordingStartedRef = useRef(false);
  // Last beat index seen, so the prep-finished fallback (below) can tell if
  // the count-in already elapsed while permissions/setup were still pending.
  const lastBeatRef = useRef(-1);

  useEffect(() => {
    toleranceRef.current = toleranceMs;
  }, [toleranceMs]);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    subdivisionRef.current = subdivision;
  }, [subdivision]);

  useEffect(() => {
    tripletTargetRef.current = tripletTarget;
  }, [tripletTarget]);

  useEffect(() => {
    maxBarsRef.current = maxBars;
  }, [maxBars]);

  useEffect(() => {
    onLimitReachedRef.current = onLimitReached;
  }, [onLimitReached]);

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
    isArmedRef.current = isArmed;
  }, [isArmed]);

  useEffect(() => {
    countInBeatsRef.current = countInBeats;
  }, [countInBeats]);

  // beatIntervalMs is the spacing between consecutive quarter-note beats,
  // derived from the exact BPM rather than a measured/jittery value.
  function currentBeatIntervalMs() {
    return 60000 / bpmRef.current;
  }

  // Opens a fresh onset-capture window for one beat, seeding it from any
  // already-collected samples that fall in range — this is what lets a beat
  // catch a slightly-early hit that happened just before its own timestamp.
  // Seeds with the *earliest* qualifying sample, matching the rising-edge
  // semantics of the live per-tick update in pollTick.
  function openBeatWindow(
    beatTime: number,
    beatIndex: number,
    subBeatIndex: number,
    windowHalf: number,
  ) {
    const windowStart = beatTime - windowHalf;
    const windowEnd = beatTime + windowHalf;

    let onsetTime: number | null = null;
    let onsetAmp: number | null = null;
    let peakAmp = 0;
    let peakTime: number | null = null;
    for (const sample of recentSamplesRef.current) {
      if (sample.time >= windowStart && sample.time <= windowEnd) {
        if (sample.amp > peakAmp) {
          peakAmp = sample.amp;
          peakTime = sample.time;
        }
        if (
          sample.risingEdge &&
          (onsetTime === null || sample.time < onsetTime)
        ) {
          onsetTime = sample.time;
          onsetAmp = sample.amp;
        }
      }
    }

    pendingBeatsRef.current = [
      ...pendingBeatsRef.current,
      {
        beatIndex,
        subBeatIndex,
        beatTime,
        windowStart,
        windowEnd,
        onsetTime,
        onsetAmp,
        peakAmp,
        peakTime,
      },
    ];
  }

  // Resolves every capture window whose deadline has passed: if a sample
  // cleared the onset threshold anywhere in the window, fires the status
  // callback for its (first-crossing) onset time and schedules the
  // short-lived flash back to neutral.
  function finalizePendingBeats(now: number) {
    const pending = pendingBeatsRef.current;
    if (!pending.length) return;

    const stillPending: PendingBeat[] = [];
    for (const point of pending) {
      if (now < point.windowEnd) {
        stillPending.push(point);
        continue;
      }

      if (point.onsetTime !== null) {
        const delta = point.onsetTime - point.beatTime;
        const inTime = Math.abs(delta) <= toleranceRef.current;
        const status: OnsetStatus = inTime
          ? "onTime"
          : delta < 0
            ? "early"
            : "late";

        onStatusChangeRef.current?.(status, delta);

        if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = setTimeout(() => {
          onStatusChangeRef.current?.(null, null);
        }, STATUS_HOLD_MS);
      }
      // No else branch: an unresolved window (nothing cleared the onset
      // threshold) has nothing left to do here now that the report's
      // events/rejectedPeaks come from analyzeSession() at teardown instead
      // of being accumulated live — this live pass only drives the
      // approximate real-time status banner above.
    }
    pendingBeatsRef.current = stillPending;
  }

  function pollTick() {
    const status = recorder.getStatus();
    const db = status.metering ?? SILENCE_FLOOR_DB;
    const norm = clamp((db - SILENCE_FLOOR_DB) / (0 - SILENCE_FLOOR_DB), 0, 1);
    const now = Date.now();

    // A sample only counts as a genuine onset if the level just crossed *up*
    // through the threshold this tick — computed before anything else below
    // touches wasAboveThresholdRef, and unconditionally (not just when
    // ungated), so a still-decaying tail from the click (or a previous note
    // ringing out) never gets mistaken for a fresh hit just because it
    // hasn't faded below the floor yet by the time a window opens.
    const risingEdge =
      norm >= MIN_PEAK_AMPLITUDE && !wasAboveThresholdRef.current;
    wasAboveThresholdRef.current = norm >= MIN_PEAK_AMPLITUDE;

    // Samples inside the click gate are dropped entirely — never recorded
    // into history, never allowed to feed any pending window's onset search.
    const gated = now <= gatedUntilRef.current;
    if (gated) {
      // Still ringing above the onset threshold — this is the click's own
      // decay tail (mic picking up the speaker/room, not the user), so
      // keep the gate closed a little longer instead of releasing on a
      // fixed timer. Bounded by CLICK_GATE_MAX_MS from when this gate was
      // first armed, so sustained background noise can't hold it open forever.
      if (norm >= MIN_PEAK_AMPLITUDE) {
        gatedUntilRef.current = Math.min(
          gateArmedAtRef.current + CLICK_GATE_MAX_MS,
          now + CLICK_GATE_EXTEND_MS,
        );
      }
    } else {
      const recent = recentSamplesRef.current;
      recent.push({ time: now, amp: norm, risingEdge });
      while (
        recent.length &&
        now - recent[0].time > RECENT_SAMPLES_MAX_AGE_MS
      ) {
        recent.shift();
      }
    }

    // Tracks each pending window's loudest sample regardless of gating —
    // the only way a gated-away hit is still visible to the debug chart
    // once the window closes (see PendingBeat.peakAmp) — and, only when
    // ungated, locks in the *first* sample that clears the real acceptance
    // threshold, ignoring every later one for that window even if louder
    // (see the PendingBeat.onsetTime comment for why).
    pendingBeatsRef.current = pendingBeatsRef.current.map((point) => {
      if (now < point.windowStart || now > point.windowEnd) return point;

      let next = point;
      if (norm > next.peakAmp) {
        next = { ...next, peakAmp: norm, peakTime: now };
      }
      if (!gated && next.onsetTime === null && risingEdge) {
        next = { ...next, onsetTime: now, onsetAmp: norm };
      }
      return next;
    });

    finalizePendingBeats(now);

    // Bucket the raw (ungated) amplitude into WAVEFORM_SAMPLE_INTERVAL_MS
    // slots for the report's full-session waveform, keeping each bucket's
    // loudest sample. Buckets are flushed to the array only once a later
    // sample proves them closed, so the very last one is flushed separately
    // on stop; any bucket skipped by a scheduling gap is backfilled with 0
    // so array index -> elapsed time stays aligned with OnsetEvent.elapsedMs.
    if (sessionStartRef.current !== null) {
      const elapsed = now - sessionStartRef.current;

      // Logged unconditionally (click-gated or not) — analyzeSession needs
      // the true complete signal, including the clicks themselves, to find
      // each one's actual decay end directly in the data.
      rawSamplesRef.current.push({ time: elapsed, amp: norm });

      const bucketIndex = Math.floor(elapsed / WAVEFORM_SAMPLE_INTERVAL_MS);
      if (bucketIndex !== waveformBucketIndexRef.current) {
        if (waveformBucketIndexRef.current >= 0) {
          waveformRef.current.push(waveformBucketMaxRef.current);
          for (
            let i = waveformBucketIndexRef.current + 1;
            i < bucketIndex;
            i++
          ) {
            waveformRef.current.push(0);
          }
        }
        waveformBucketIndexRef.current = bucketIndex;
        waveformBucketMaxRef.current = norm;
      } else {
        waveformBucketMaxRef.current = Math.max(
          waveformBucketMaxRef.current,
          norm,
        );
      }
    }

    // Mutate shared values directly (UI thread) instead of setState — this is
    // the fix for the recording-time lag, see the summary after the tool calls.
    amplitudesSV.value = [...amplitudesSV.value.slice(1), norm];
    accentsSV.value = [...accentsSV.value.slice(1), pendingBeatRef.current];
    pendingBeatRef.current = null;
  }

  // Warms up the mic one beat *before* the tracked session starts: calls
  // recorder.record() and kicks off the poll loop so samples are already
  // flowing by the time the real first beat's peak-capture window opens.
  // Starting this exactly on the tracked beat itself would still miss it —
  // recorder.record() has its own native startup latency even when already
  // prepared, so the lead-in beat absorbs that instead of the first hit.
  // Idempotent: guarded by audioStartedRef so it only ever runs once per arm cycle.
  function maybeStartAudioPipeline(beat: number) {
    if (!isArmedRef.current || !preparedRef.current || audioStartedRef.current)
      return;
    const leadInBeat = Math.max(0, countInBeatsRef.current - 1);
    if (beat < leadInBeat) return;

    audioStartedRef.current = true;
    recorder.record();
    pollIntervalRef.current = setInterval(pollTick, POLL_INTERVAL_MS);
  }

  // Flips on the tracked session (elapsedMs baseline, event/waveform
  // collection) — this is "beat 1". Called synchronously from the onBeat
  // handler on the exact beat that ends the count-in (or, as a fallback,
  // from the prep effect if setup was still pending at that moment).
  function maybeStartTrackedSession(beat: number, now: number) {
    if (
      !isArmedRef.current ||
      !preparedRef.current ||
      recordingStartedRef.current
    )
      return;
    if (beat < countInBeatsRef.current) return;

    recordingStartedRef.current = true;
    recordingStartBeatRef.current = beat;
    sessionStartRef.current = now;
    rawSamplesRef.current = [];
    waveformRef.current = [];
    waveformBucketIndexRef.current = -1;
    waveformBucketMaxRef.current = 0;
    onRecordingStartRef.current?.();
  }

  // Track metronome beats: each onBeat opens a peak-capture window on its
  // own timestamp. The click gate is armed right after so this same beat's
  // own click can't be mistaken for the user's onset.
  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onBeat",
      ({ beat, accent }: BeatEventPayload) => {
        const now = Date.now();
        lastBeatRef.current = beat;
        pendingBeatRef.current = accent;

        // Resolve any straggling windows early (only possible at very fast tempos).
        finalizePendingBeats(now);

        // Auto-stop (setup screen's bars count): once maxBars worth of
        // native beats have played since the tracked session started, this
        // beat itself is one past the limit — finalizePendingBeats above
        // has already had a full beat interval to resolve the true last
        // beat's window, so it's safe to bail here without opening a new
        // one. The caller stops the engine; onSessionEnd fires from the
        // teardown that triggers (same path a manual Stop already uses).
        if (
          recordingStartedRef.current &&
          maxBarsRef.current != null &&
          recordingStartBeatRef.current !== null &&
          beat - recordingStartBeatRef.current >=
            maxBarsRef.current * BEATS_PER_BAR
        ) {
          onLimitReachedRef.current?.();
          return;
        }

        const beatIndex = beat % BEATS_PER_BAR;
        const beatIntervalMs = currentBeatIntervalMs();
        const steps = SUBDIVISION_STEPS[subdivisionRef.current];
        const subIntervalMs = beatIntervalMs / steps;
        const windowHalf = currentWindowHalfMs(subIntervalMs);

        // One window per *evaluated* sub-beat — just the native beat itself
        // for plain quarters, all `steps` positions for sixteenths, but only
        // the chosen off-beat for eighths/triplets (see evaluatedSubBeats):
        // every non-evaluated sub-beat intentionally never gets a window,
        // so it can never become an accepted/rejected onset.
        for (const sub of evaluatedSubBeats(
          subdivisionRef.current,
          tripletTargetRef.current,
        )) {
          openBeatWindow(now + sub * subIntervalMs, beatIndex, sub, windowHalf);
        }

        gateArmedAtRef.current = now;
        gatedUntilRef.current = now + CLICK_GATE_MS;

        // See the comment on countInBeats for why these can't go through a
        // prop/state flip instead.
        maybeStartAudioPipeline(beat);
        maybeStartTrackedSession(beat, now);
      },
    );
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Does all the slow, audio-session-touching setup (permissions,
  // setAudioModeAsync, prepareToRecordAsync) as soon as the recorder is
  // armed — typically from the start of the count-in — instead of at the
  // instant recording is supposed to start. Reconfiguring the audio session
  // while the metronome engine is actively playing is what causes an
  // audible stutter, so doing it early lets that settle during the
  // count-in instead of right as the real recording kicks in.
  //
  // Real recording itself is *not* started here — it's started from the
  // onBeat handler above, synchronously, the moment the count-in elapses.
  // The only exception is the fallback below, for the rare case where the
  // count-in already elapsed before this setup finished.
  useEffect(() => {
    if (!isArmed) {
      preparedRef.current = false;
      return;
    }

    let cancelled = false;

    (async () => {
      let permission = await getRecordingPermissionsAsync();
      if (!permission.granted) {
        permission = await requestRecordingPermissionsAsync();
      }
      if (!permission.granted) {
        if (!cancelled) setPermissionDenied(true);
        return;
      }
      if (cancelled) return;
      setPermissionDenied(false);

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      if (cancelled) return;
      await recorder.prepareToRecordAsync();
      if (cancelled) return;

      preparedRef.current = true;

      // Fallback: the count-in already elapsed while setup was still
      // pending (very fast tempo, or a slow permission prompt) — catch up
      // now instead of silently missing the lead-in and/or the session.
      maybeStartAudioPipeline(lastBeatRef.current);
      maybeStartTrackedSession(lastBeatRef.current, Date.now());
    })();

    return () => {
      cancelled = true;

      // Tear down everything armed — whether we were still counting in or
      // a real recording session had already started.
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      recorder.stop().catch(() => {});
      pendingBeatRef.current = null;
      recentSamplesRef.current = [];
      wasAboveThresholdRef.current = false;
      pendingBeatsRef.current = [];
      gatedUntilRef.current = 0;
      gateArmedAtRef.current = 0;
      preparedRef.current = false;
      audioStartedRef.current = false;
      recordingStartedRef.current = false;
      recordingStartBeatRef.current = null;
      lastBeatRef.current = -1;
      amplitudesSV.value = new Array(HISTORY_SIZE).fill(0);
      accentsSV.value = new Array(HISTORY_SIZE).fill(null);
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      onStatusChangeRef.current?.(null, null);

      if (sessionStartRef.current !== null) {
        // Flush the in-progress bucket — it never got closed by a later
        // sample crossing into the next bucket, since recording just stopped.
        if (waveformBucketIndexRef.current >= 0) {
          waveformRef.current.push(waveformBucketMaxRef.current);
          waveformBucketIndexRef.current = -1;
        }

        const durationMs = Date.now() - sessionStartRef.current;
        const { events, rejectedPeaks } = analyzeSession(
          rawSamplesRef.current,
          durationMs,
          bpmRef.current,
          subdivisionRef.current,
          tripletTargetRef.current,
          toleranceRef.current,
        );

        onSessionEndRef.current?.({
          events,
          rejectedPeaks,
          durationMs,
          toleranceMs: toleranceRef.current,
          bpm: bpmRef.current,
          subdivision: subdivisionRef.current,
          tripletTarget: tripletTargetRef.current,
          waveform: waveformRef.current,
        });
        sessionStartRef.current = null;
        rawSamplesRef.current = [];
        waveformRef.current = [];
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isArmed]);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  const bars = Array.from({ length: HISTORY_SIZE });

  return (
    <DarkPanel className="px-4 py-4 gap-3 w-full">
      <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
        Input audio
      </Text>

      {permissionDenied ? (
        <View
          style={{ height: WAVEFORM_PANEL_HEIGHT }}
          className="items-center justify-center"
        >
          <Text className="text-white text-center text-sm px-4">
            Microfono non autorizzato. Abilita l&apos;accesso dalle impostazioni
            per vedere la sincronizzazione.
          </Text>
        </View>
      ) : (
        <View
          style={{ height: WAVEFORM_PANEL_HEIGHT }}
          className="flex-row items-end overflow-hidden"
        >
          {bars.map((_, index) => (
            <WaveformBar
              key={index}
              index={index}
              amplitudes={amplitudesSV}
              accents={accentsSV}
            />
          ))}
        </View>
      )}

      <Text className="text-neutral-600 text-[10px] leading-4">
        Suggerimento: usa cuffie o auricolari per una rilevazione più precisa —
        evita che il microfono capti anche il click del metronomo.
      </Text>
    </DarkPanel>
  );
}
