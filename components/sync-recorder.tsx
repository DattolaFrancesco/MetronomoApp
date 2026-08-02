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

export const DEFAULT_TOLERANCE_MS = 50;

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
export const MIN_PEAK_AMPLITUDE = 0.4;
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

// Which sub-beat indices within each quarter actually get an onset-capture
// window opened. For every subdivision except "eighth" this is simply every
// step (0..steps-1). "eighth" is a deliberate exception: only the off-beat
// (the eighth note halfway between quarters, sub-beat 1 — "il levare") is
// evaluated; the quarter itself (sub-beat 0, "il battere") is skipped
// entirely, so it never becomes an accepted/rejected onset anywhere
// (report, debug chart). See beat-indicator.tsx for the purely-visual
// distinction this implies (both points are still shown there, just
// differently styled).
export const EVALUATED_SUB_BEATS: Record<Subdivision, number[]> = {
  quarter: [0],
  eighth: [1],
  triplet: [0, 1, 2],
  sixteenth: [0, 1, 2, 3],
};

// Which sub-beat is the "primary" (prominent, glowing) marker in
// beat-indicator.tsx. For every subdivision except "eighth" this is the
// native quarter itself. "eighth" is the exception, matching
// EVALUATED_SUB_BEATS above: since only the off-beat is actually judged by
// peak detection, it's the off-beat that's drawn prominent — the quarter
// is still shown, just demoted to the secondary/outline style.
export const PRIMARY_SUB_BEAT: Record<Subdivision, number> = {
  quarter: 0,
  eighth: 1,
  triplet: 0,
  sixteenth: 0,
};

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
  // determines how many onset-capture windows exist per quarter beat. Not
  // yet reflected in the report's own grid/barline drawing (session-report.tsx
  // still assumes plain quarters) — a known follow-up, not fixed here.
  subdivision: Subdivision;
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
  const recentSamplesRef = useRef<{ time: number; amp: number }[]>([]);
  const pendingBeatsRef = useRef<PendingBeat[]>([]);
  const gatedUntilRef = useRef(0);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionStartRef = useRef<number | null>(null);
  const sessionEventsRef = useRef<OnsetEvent[]>([]);
  const eventIdRef = useRef(0);
  const sessionRejectedPeaksRef = useRef<RejectedPeak[]>([]);
  const rejectedPeakIdRef = useRef(0);
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

  function currentWindowHalfMs(beatIntervalMs: number) {
    const ratioBased = clamp(
      beatIntervalMs * WINDOW_HALF_RATIO,
      WINDOW_HALF_MIN_MS,
      WINDOW_HALF_MAX_MS,
    );
    const safetyCap = beatIntervalMs / 2 - WINDOW_SAFETY_MARGIN_MS;
    return Math.max(10, Math.min(ratioBased, safetyCap));
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
          sample.amp >= MIN_PEAK_AMPLITUDE &&
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

        if (sessionStartRef.current !== null) {
          sessionEventsRef.current.push({
            id: eventIdRef.current++,
            elapsedMs: point.beatTime - sessionStartRef.current,
            deltaMs: delta,
            status,
            beatIndex: point.beatIndex,
            subBeatIndex: point.subBeatIndex,
            amplitude: point.onsetAmp ?? 0,
          });
        }
      } else if (sessionStartRef.current !== null && point.peakTime !== null) {
        // Nothing cleared the onset threshold in this window — but if
        // something loud enough to matter happened anyway, log *why* it
        // didn't count instead of just silently dropping it. A peak that
        // reached MIN_PEAK_AMPLITUDE but still has no onsetTime can only
        // mean it happened while the click gate was active (any ungated
        // sample clearing the threshold would already have set onsetTime
        // above) — everything quieter than that is a near-miss below the
        // real acceptance threshold.
        const reason: PeakRejectReason =
          point.peakAmp >= MIN_PEAK_AMPLITUDE ? "gated" : "belowThreshold";
        if (point.peakAmp >= DEBUG_CANDIDATE_FLOOR) {
          sessionRejectedPeaksRef.current.push({
            id: rejectedPeakIdRef.current++,
            elapsedMs: point.peakTime - sessionStartRef.current,
            amplitude: point.peakAmp,
            reason,
            beatIndex: point.beatIndex,
            subBeatIndex: point.subBeatIndex,
            deltaMs: point.peakTime - point.beatTime,
          });
        }
      }
    }
    pendingBeatsRef.current = stillPending;
  }

  function pollTick() {
    const status = recorder.getStatus();
    const db = status.metering ?? SILENCE_FLOOR_DB;
    const norm = clamp((db - SILENCE_FLOOR_DB) / (0 - SILENCE_FLOOR_DB), 0, 1);
    const now = Date.now();

    // Samples inside the click gate are dropped entirely — never recorded
    // into history, never allowed to feed any pending window's onset search.
    const gated = now <= gatedUntilRef.current;
    if (!gated) {
      const recent = recentSamplesRef.current;
      recent.push({ time: now, amp: norm });
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
      if (!gated && next.onsetTime === null && norm >= MIN_PEAK_AMPLITUDE) {
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
    sessionEventsRef.current = [];
    eventIdRef.current = 0;
    sessionRejectedPeaksRef.current = [];
    rejectedPeakIdRef.current = 0;
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
          beat - recordingStartBeatRef.current >= maxBarsRef.current * BEATS_PER_BAR
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
        // for plain quarters, all `steps` positions for triplets/sixteenths,
        // but only the off-beat for eighths (see EVALUATED_SUB_BEATS): the
        // quarter itself intentionally never gets a window there, so it can
        // never become an accepted/rejected onset.
        for (const sub of EVALUATED_SUB_BEATS[subdivisionRef.current]) {
          openBeatWindow(now + sub * subIntervalMs, beatIndex, sub, windowHalf);
        }

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
      pendingBeatsRef.current = [];
      gatedUntilRef.current = 0;
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

        onSessionEndRef.current?.({
          events: sessionEventsRef.current,
          rejectedPeaks: sessionRejectedPeaksRef.current,
          durationMs: Date.now() - sessionStartRef.current,
          toleranceMs: toleranceRef.current,
          bpm: bpmRef.current,
          subdivision: subdivisionRef.current,
          waveform: waveformRef.current,
        });
        sessionStartRef.current = null;
        sessionEventsRef.current = [];
        sessionRejectedPeaksRef.current = [];
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
