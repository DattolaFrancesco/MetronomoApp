import DarkPanel from "@/components/dark-panel";
import { useTranslation } from "@/lib/i18n";
import {
  analyzeOnsetSession,
  analyzeSession,
  BEATS_PER_BAR,
  classifyOnset,
  CLICK_GATE_EXTEND_MS,
  CLICK_GATE_MAX_MS,
  CLICK_GATE_MS,
  clamp,
  computeClickGateEnd,
  currentWindowHalfMs,
  DEFAULT_TOLERANCE_MS,
  evaluatedSubBeats,
  extendClickGate,
  isWithinClickGate,
  MIN_ONSET_RISE,
  MIN_ONSET_STRENGTH,
  MIN_PEAK_AMPLITUDE,
  primarySubBeat,
  type DisplayEnvelope,
  type SixteenthTarget,
  SUBDIVISION_STEPS,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  type HitDiagnostic,
  type OnsetEvent,
  type OnsetStatus,
  type PeakRejectReason,
  type RejectedPeak,
  type SessionSummary,
  type Subdivision,
  type TripletTarget,
} from "@/lib/rhythm-detection";
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
  type OnsetEventPayload,
} from "expo-precision-metronome";
import { memo, useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

// iOS gets its onset detection from the native spectral-flux detector (see
// expo-precision-metronome's OnsetDetector.swift) instead of this file's
// legacy expo-audio metering/poll pipeline — see the branches below keyed on
// this constant. Android has no native onset detector yet (see the patch's
// startOnsetDetection stub), so it stays on the original path unchanged.
const IS_IOS = Platform.OS === "ios";

// All the pure rhythm/onset-detection math (expected timestamps, peak
// selection, the rise/derivative onset criterion, early/on-time/late
// classification, click gating) lives in lib/rhythm-detection.ts, unit
// tested there — this component only re-exports what other files under
// components/ and app/ still import from here, and wires that pure logic up
// to the mic/hooks/timers.
export {
  BEATS_PER_BAR,
  CLICK_GATE_MS,
  currentWindowHalfMs,
  DEFAULT_TOLERANCE_MS,
  MIN_ONSET_RISE,
  MIN_PEAK_AMPLITUDE,
  SUBDIVISION_STEPS,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  evaluatedSubBeats,
  primarySubBeat,
  type DisplayEnvelope,
  type HitDiagnostic,
  type OnsetEvent,
  type OnsetStatus,
  type PeakRejectReason,
  type RejectedPeak,
  type SessionSummary,
  type SixteenthTarget,
  type Subdivision,
  type TripletTarget,
};

// Polling drives both the peak search and the click-gate resolution.
const POLL_INTERVAL_MS = 20;
const HISTORY_SIZE = 70;

const SILENCE_FLOOR_DB = -50;

const RECENT_SAMPLES_MAX_AGE_MS = 200;
const STATUS_HOLD_MS = 180;

const MAX_BAR_HEIGHT = 64;
const WAVEFORM_PANEL_HEIGHT = 80;
const BAR_COLOR = "#FF3B30";

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
  // Which triplet note (2nd or 3rd) to evaluate when subdivision is
  // "triplet" — chosen on the recording screen, not the setup step. Ignored
  // for every other subdivision.
  tripletTarget?: TripletTarget;
  // Same idea as tripletTarget, for "sixteenth" (2nd/3rd/4th sixteenth
  // note). Ignored for every other subdivision.
  sixteenthTarget?: SixteenthTarget;
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
  sixteenthTarget = 2,
  maxBars,
  onSessionEnd,
  onStatusChange,
  onRecordingStart,
  onLimitReached,
}: SyncRecorderProps) {
  const { t } = useTranslation();
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
  const sixteenthTargetRef = useRef(sixteenthTarget);
  const maxBarsRef = useRef(maxBars);
  const onLimitReachedRef = useRef(onLimitReached);
  // Native beat number (since the engine's own start()) of the beat that
  // started the tracked session — lets the onBeat handler compute "how many
  // beats into the session are we" without any extra counter of its own.
  const recordingStartBeatRef = useRef<number | null>(null);
  // Pending call to onLimitReachedRef, scheduled a bit after the auto-stop
  // condition is first detected (see the onBeat handler below) instead of
  // fired synchronously — gives the mic a little extra post-roll past the
  // last real beat before recording actually tears down. Also guards
  // against scheduling it twice (the engine keeps ticking, so onBeat keeps
  // firing, until the delayed call above actually reaches the parent and
  // stops it).
  const limitReachedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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

  // --- iOS native onset detector state (see IS_IOS above) ---
  // Whether ExpoPrecisionMetronomeModule.startOnsetDetection() actually
  // resolved for the current arm cycle — gates whether teardown needs to
  // call stopOnsetDetection()/getCaptureEnvelope() at all.
  const nativeOnsetStartedRef = useRef(false);
  // Raw AVAudioTime host-time ms of the tracked session's true beat 1 — same
  // clock as BeatEventPayload.hostTimeMs/OnsetEventPayload.hostTimeMs, and
  // the origin every collected onset timestamp is converted to elapsedMs
  // against at teardown. Distinct from sessionStartRef (Date.now()-based,
  // kept for durationMs and the "is a session running" check on both
  // platforms).
  const sessionStartHostMsRef = useRef<number | null>(null);
  // Every onset the native detector has reported since the audio pipeline
  // armed (maybeStartAudioPipeline), host-time ms, index-aligned with
  // onsetStrengthsRef — the raw input to analyzeOnsetSession at teardown.
  const onsetTimesRef = useRef<number[]>([]);
  const onsetStrengthsRef = useRef<number[]>([]);
  // Mirrors lastBeatRef but for hostTimeMs — needed by the prep-finished
  // fallback path (see the effect below) to seed sessionStartHostMsRef if
  // the count-in already elapsed before setup finished.
  const lastBeatHostTimeMsRef = useRef(0);
  // Live capture windows for the approximate status banner, iOS's
  // event-driven counterpart to pendingBeatsRef below — matched directly
  // against onOnset events (host-time ms) instead of polled amplitude
  // samples, since the native detector already reports exact attack
  // timestamps and already excludes the metronome's own click.
  const pendingOnsetWindowsRef = useRef<
    {
      id: number;
      windowStart: number;
      windowEnd: number;
      beatTimeHostMs: number;
      matchedHostTimeMs: number | null;
    }[]
  >([]);
  const onsetWindowIdRef = useRef(0);
  // Current amplitude driving the live waveform bars on iOS — spiked by an
  // incoming onset's strength, decayed each iosVisualTick instead of being
  // read straight off a polled mic level (there's no continuous live level
  // to poll; the native detector only reports discrete attacks + a capture
  // envelope read once at teardown).
  const iosCurrentAmpRef = useRef(0);

  // The "beat 1" timestamp — elapsedMs=0 for everything reported (events,
  // durationMs). Unlike waveformStartRef below, this is never shifted, so
  // existing elapsedMs/deltaMs semantics stay exactly "relative to the
  // true first beat" regardless of the pre-roll margin.
  const sessionStartRef = useRef<number | null>(null);
  // When bucket index 0 of waveformRef actually starts — set as soon as
  // the mic pipeline starts (the lead-in beat, see maybeStartAudioPipeline),
  // *before* sessionStartRef, so real pre-roll audio is captured instead of
  // discarded. Trimmed down to a small, tempo-adaptive margin (see
  // leadInMsRef) the moment beat 1 actually arrives.
  const waveformStartRef = useRef<number | null>(null);
  // How far before sessionStartRef (true beat 1) waveformStartRef actually
  // sits, after trimming — passed to analyzeSession/SessionSummary so it
  // can convert between "true" elapsedMs and waveform-array bucket index.
  const leadInMsRef = useRef(0);
  // Decimated (50ms bucket-max) amplitude history for the whole session —
  // this is both what the report's waveform bars are drawn from and what
  // analyzeSession() replays once at teardown to build events, instead of
  // trying to classify each hit live as it happens. Indexed relative to
  // waveformStartRef, not sessionStartRef — see leadInMsRef.
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
    sixteenthTargetRef.current = sixteenthTarget;
  }, [sixteenthTarget]);

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
        const status = classifyOnset(delta, toleranceRef.current);

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
    const gated = isWithinClickGate(now, gatedUntilRef.current);
    if (gated) {
      // Still ringing above the onset threshold — this is the click's own
      // decay tail (mic picking up the speaker/room, not the user), so
      // keep the gate closed a little longer instead of releasing on a
      // fixed timer. Bounded by CLICK_GATE_MAX_MS from when this gate was
      // first armed, so sustained background noise can't hold it open forever.
      gatedUntilRef.current = extendClickGate(
        gateArmedAtRef.current,
        gatedUntilRef.current,
        now,
        norm,
        MIN_PEAK_AMPLITUDE,
        CLICK_GATE_EXTEND_MS,
        CLICK_GATE_MAX_MS,
      );
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
    // so array index -> elapsed time stays aligned (see leadInMsRef for the
    // offset between bucket index and true elapsedMs). Gated on
    // waveformStartRef (set when the mic pipeline starts, one beat before
    // sessionStartRef) rather than sessionStartRef itself, so real pre-roll
    // audio from that lead-in beat is actually captured.
    if (waveformStartRef.current !== null) {
      const elapsed = now - waveformStartRef.current;
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

  // iOS counterpart to openBeatWindow: opens a live capture window keyed on
  // host-time ms (beatTimeHostMs, same clock as onOnset events) instead of
  // Date.now(). Resolved by a setTimeout instead of pollTick's per-tick
  // sweep, since there's no poll loop scanning amplitude on iOS — windowHalf
  // ms after opening is when this window's onset search would have closed
  // anyway, so that's when the timeout fires (+ a little slack for the
  // event to actually arrive over the bridge).
  function openOnsetBeatWindow(
    beatTimeHostMs: number,
    windowHalf: number,
  ) {
    const id = onsetWindowIdRef.current++;
    pendingOnsetWindowsRef.current.push({
      id,
      beatTimeHostMs,
      windowStart: beatTimeHostMs - windowHalf,
      windowEnd: beatTimeHostMs + windowHalf,
      matchedHostTimeMs: null,
    });
    setTimeout(() => resolveOnsetWindow(id), windowHalf + 15);
  }

  // Fires the same approximate status banner as finalizePendingBeats, once
  // this window's deadline has passed — using the exact host-time delta
  // between the matched onset and the beat instead of a polled sample time.
  function resolveOnsetWindow(id: number) {
    const list = pendingOnsetWindowsRef.current;
    const index = list.findIndex((w) => w.id === id);
    if (index === -1) return;
    const win = list[index];
    pendingOnsetWindowsRef.current = list.filter((w) => w.id !== id);

    if (win.matchedHostTimeMs !== null) {
      const delta = win.matchedHostTimeMs - win.beatTimeHostMs;
      const status = classifyOnset(delta, toleranceRef.current);

      onStatusChangeRef.current?.(status, delta);

      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = setTimeout(() => {
        onStatusChangeRef.current?.(null, null);
      }, STATUS_HOLD_MS);
    }
  }

  // iOS counterpart to pollTick, but purely cosmetic: there's no continuous
  // mic level to sample (the native detector only emits discrete onsets), so
  // this just animates the same sliding bars/accent flash off
  // iosCurrentAmpRef (spiked by onOnset, decayed here every tick) instead of
  // driving any actual detection.
  function iosVisualTick() {
    amplitudesSV.value = [...amplitudesSV.value.slice(1), iosCurrentAmpRef.current];
    accentsSV.value = [...accentsSV.value.slice(1), pendingBeatRef.current];
    pendingBeatRef.current = null;
    iosCurrentAmpRef.current =
      iosCurrentAmpRef.current < 0.02 ? 0 : iosCurrentAmpRef.current * 0.75;
  }

  // Warms up the mic one beat *before* the tracked session starts: calls
  // recorder.record() and kicks off the poll loop so samples are already
  // flowing by the time the real first beat's peak-capture window opens.
  // Starting this exactly on the tracked beat itself would still miss it —
  // recorder.record() has its own native startup latency even when already
  // prepared, so the lead-in beat absorbs that instead of the first hit.
  // Also opens the waveform array right here (not at beat 1) so this whole
  // lead-in beat's real audio is captured — maybeStartTrackedSession then
  // trims it down to a small pre-roll margin once beat 1 actually arrives.
  // Idempotent: guarded by audioStartedRef so it only ever runs once per arm cycle.
  function maybeStartAudioPipeline(beat: number, now: number) {
    if (!isArmedRef.current || !preparedRef.current || audioStartedRef.current)
      return;
    const leadInBeat = Math.max(0, countInBeatsRef.current - 1);
    if (beat < leadInBeat) return;

    audioStartedRef.current = true;
    waveformStartRef.current = now;
    waveformRef.current = [];
    waveformBucketIndexRef.current = -1;
    waveformBucketMaxRef.current = 0;

    if (IS_IOS) {
      onsetTimesRef.current = [];
      onsetStrengthsRef.current = [];
      pendingOnsetWindowsRef.current = [];
      iosCurrentAmpRef.current = 0;
      ExpoPrecisionMetronomeModule.startOnsetDetection()
        .then(() => {
          nativeOnsetStartedRef.current = true;
        })
        .catch(() => {});
      pollIntervalRef.current = setInterval(iosVisualTick, POLL_INTERVAL_MS);
    } else {
      recorder.record();
      pollIntervalRef.current = setInterval(pollTick, POLL_INTERVAL_MS);
    }
  }

  // Flips on the tracked session (elapsedMs baseline, event/waveform
  // collection) — this is "beat 1". Called synchronously from the onBeat
  // handler on the exact beat that ends the count-in (or, as a fallback,
  // from the prep effect if setup was still pending at that moment).
  function maybeStartTrackedSession(
    beat: number,
    now: number,
    hostTimeMs?: number,
  ) {
    if (
      !isArmedRef.current ||
      !preparedRef.current ||
      recordingStartedRef.current
    )
      return;
    if (beat < countInBeatsRef.current) return;

    recordingStartedRef.current = true;
    recordingStartBeatRef.current = beat;

    if (IS_IOS) {
      // No waveform-bucket concept on iOS — analyzeOnsetSession matches
      // discrete onset timestamps directly, so there's nothing to trim.
      sessionStartHostMsRef.current = hostTimeMs ?? lastBeatHostTimeMsRef.current;
      leadInMsRef.current = 0;
    } else {
      // The lead-in beat (maybeStartAudioPipeline, above) has been capturing
      // real audio since roughly one full beat before now — trim that down
      // to a small, tempo-adaptive pre-roll margin (same sizing as a beat's
      // own onset-capture window) instead of keeping the whole beat, so a
      // slow tempo doesn't turn into a huge "before the first quarter" slice.
      // Only ever shrinks the array (never grows it) since the desired
      // margin is always well under the elapsed lead-in beat.
      if (waveformStartRef.current !== null) {
        const desiredLeadInMs = currentWindowHalfMs(currentBeatIntervalMs());
        const elapsedSinceWaveformStart = now - waveformStartRef.current;
        const excessBuckets = Math.min(
          waveformRef.current.length,
          Math.floor(
            (elapsedSinceWaveformStart - desiredLeadInMs) / WAVEFORM_SAMPLE_INTERVAL_MS,
          ),
        );
        if (excessBuckets > 0) {
          waveformRef.current = waveformRef.current.slice(excessBuckets);
          waveformStartRef.current += excessBuckets * WAVEFORM_SAMPLE_INTERVAL_MS;
          waveformBucketIndexRef.current -= excessBuckets;
        }
        leadInMsRef.current = now - waveformStartRef.current;
      } else {
        leadInMsRef.current = 0;
      }
    }

    sessionStartRef.current = now;
    onRecordingStartRef.current?.();
  }

  // Track metronome beats: each onBeat opens a peak-capture window on its
  // own timestamp. The click gate is armed right after so this same beat's
  // own click can't be mistaken for the user's onset.
  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onBeat",
      ({ beat, accent, hostTimeMs }: BeatEventPayload) => {
        const now = Date.now();
        lastBeatRef.current = beat;
        lastBeatHostTimeMsRef.current = hostTimeMs;
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
        //
        // The actual call is delayed by half a beat instead of firing here
        // synchronously — this phantom beat is already ~one full
        // beatIntervalMs past the true last beat, but a late final hit
        // (e.g. a triplet's 3rd note, or the 4th sixteenth) can still need
        // more: its own onset-capture window reaches up to another half
        // beat past its target. Without this, that window gets clipped by
        // the waveform array's own end and the hit is unmatchable no
        // matter how the user actually played it (see analyzeSession's
        // matchRadius in lib/rhythm-detection.ts). Staying under a full
        // beat keeps this silent — the engine gets stopped (from inside
        // the delayed call) before it would otherwise play another click.
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

        const beatIndex = beat % BEATS_PER_BAR;
        const beatIntervalMs = currentBeatIntervalMs();
        const steps = SUBDIVISION_STEPS[subdivisionRef.current];
        const subIntervalMs = beatIntervalMs / steps;
        const windowHalf = currentWindowHalfMs(subIntervalMs);

        // One window per *evaluated* sub-beat — just the native beat itself
        // for plain quarters, only the chosen off-beat for
        // eighths/triplets/sixteenths (see evaluatedSubBeats): every
        // non-evaluated sub-beat intentionally never gets a window, so it
        // can never become an accepted/rejected onset.
        for (const sub of evaluatedSubBeats(
          subdivisionRef.current,
          tripletTargetRef.current,
          sixteenthTargetRef.current,
        )) {
          if (IS_IOS) {
            openOnsetBeatWindow(hostTimeMs + sub * subIntervalMs, windowHalf);
          } else {
            openBeatWindow(now + sub * subIntervalMs, beatIndex, sub, windowHalf);
          }
        }

        gateArmedAtRef.current = now;
        gatedUntilRef.current = computeClickGateEnd(now, CLICK_GATE_MS);

        // See the comment on countInBeats for why these can't go through a
        // prop/state flip instead.
        maybeStartAudioPipeline(beat, now);
        maybeStartTrackedSession(beat, now, hostTimeMs);
      },
    );
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS only in practice (see IS_IOS) — Android/web never emit onOnset, so
  // this listener just sits idle there. Every onset is recorded into
  // onsetTimesRef/onsetStrengthsRef unfiltered (analyzeOnsetSession applies
  // MIN_ONSET_STRENGTH itself at teardown, same as it does for a real mic
  // session played back offline); only the *live* banner/visual feedback
  // below applies the strength gate early, so a barely-above-noise transient
  // doesn't flash a false status or pulse the waveform bars.
  useEffect(() => {
    const subscription = ExpoPrecisionMetronomeModule.addListener(
      "onOnset",
      ({ hostTimeMs, strength }: OnsetEventPayload) => {
        if (audioStartedRef.current) {
          onsetTimesRef.current.push(hostTimeMs);
          onsetStrengthsRef.current.push(strength);
        }

        if (strength < MIN_ONSET_STRENGTH) return;

        iosCurrentAmpRef.current = Math.max(iosCurrentAmpRef.current, strength);

        for (const win of pendingOnsetWindowsRef.current) {
          if (win.matchedHostTimeMs !== null) continue;
          if (hostTimeMs >= win.windowStart && hostTimeMs <= win.windowEnd) {
            win.matchedHostTimeMs = hostTimeMs;
          }
        }
      },
    );
    return () => subscription.remove();
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
      // On iOS the native onset detector taps the metronome's own
      // AVAudioEngine directly (see maybeStartAudioPipeline) — a second,
      // separate AVAudioRecorder capture here would just double up on the
      // mic for no benefit, so skip expo-audio's own prepare/record on that
      // platform. setAudioModeAsync above still matters everywhere: it's
      // what puts the session into .playAndRecord and is what
      // startOnsetDetection requires to already be in place.
      if (!IS_IOS) {
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
      }

      preparedRef.current = true;

      // Fallback: the count-in already elapsed while setup was still
      // pending (very fast tempo, or a slow permission prompt) — catch up
      // now instead of silently missing the lead-in and/or the session.
      const fallbackNow = Date.now();
      maybeStartAudioPipeline(lastBeatRef.current, fallbackNow);
      maybeStartTrackedSession(
        lastBeatRef.current,
        fallbackNow,
        lastBeatHostTimeMsRef.current,
      );
    })();

    return () => {
      cancelled = true;

      // Tear down everything armed — whether we were still counting in or
      // a real recording session had already started.
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (limitReachedTimeoutRef.current) {
        clearTimeout(limitReachedTimeoutRef.current);
        limitReachedTimeoutRef.current = null;
      }
      if (IS_IOS) {
        if (nativeOnsetStartedRef.current) {
          nativeOnsetStartedRef.current = false;
          ExpoPrecisionMetronomeModule.stopOnsetDetection().catch(() => {});
        }
      } else {
        recorder.stop().catch(() => {});
      }
      pendingBeatRef.current = null;
      recentSamplesRef.current = [];
      wasAboveThresholdRef.current = false;
      pendingBeatsRef.current = [];
      pendingOnsetWindowsRef.current = [];
      iosCurrentAmpRef.current = 0;
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
        const durationMs = Date.now() - sessionStartRef.current;

        if (IS_IOS && sessionStartHostMsRef.current !== null) {
          const sessionStartHostMs = sessionStartHostMsRef.current;
          const onsetTimesMs = onsetTimesRef.current.map(
            (t) => t - sessionStartHostMs,
          );
          const onsetStrengths = onsetStrengthsRef.current;
          const { events, hitDiagnostics } = analyzeOnsetSession(
            onsetTimesMs,
            onsetStrengths,
            durationMs,
            bpmRef.current,
            subdivisionRef.current,
            tripletTargetRef.current,
            sixteenthTargetRef.current,
            toleranceRef.current,
            maxBarsRef.current,
          );

          const baseSummary: SessionSummary = {
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
            inputSource: "microphone",
            onsetTimesMs,
            onsetStrengths,
          };

          // getCaptureEnvelope is a native round-trip, so the report's fine
          // envelope trace arrives a beat after everything else — fine,
          // since the caller (typically a report screen) is only ever
          // shown once this whole callback fires anyway. Falls back to
          // emitting without displayEnvelope if the native call errors
          // (e.g. the engine already tore down), rather than losing the
          // real events/hitDiagnostics along with it.
          ExpoPrecisionMetronomeModule.getCaptureEnvelope()
            .then((snap) => {
              // startOffsetMs follows the same sign convention as
              // SessionSummary.leadInMs: positive when values[0] sits
              // *before* true beat 1 (the normal case — the native tap
              // starts during the lead-in beat) — i.e.
              // sessionStartHostMs - snap.startHostMs, not the reverse.
              // Getting this backwards shifts the whole displayEnvelope
              // trace forward by 2x the real offset relative to the
              // (correctly-computed) onset markers, which is exactly what
              // made early hits' real humps appear to land under later
              // hits' onset lines instead of their own.
              const displayEnvelope: DisplayEnvelope = {
                values: snap.values,
                hopMs: snap.hopMs,
                startOffsetMs: sessionStartHostMs - snap.startHostMs,
              };
              onSessionEndRef.current?.({ ...baseSummary, displayEnvelope });
            })
            .catch(() => {
              onSessionEndRef.current?.(baseSummary);
            });
        } else {
          // Flush the in-progress bucket — it never got closed by a later
          // sample crossing into the next bucket, since recording just
          // stopped.
          if (waveformBucketIndexRef.current >= 0) {
            waveformRef.current.push(waveformBucketMaxRef.current);
            waveformBucketIndexRef.current = -1;
          }

          const { events, rejectedPeaks, hitDiagnostics } = analyzeSession(
            waveformRef.current,
            durationMs,
            bpmRef.current,
            subdivisionRef.current,
            tripletTargetRef.current,
            sixteenthTargetRef.current,
            toleranceRef.current,
            maxBarsRef.current,
            leadInMsRef.current,
          );

          onSessionEndRef.current?.({
            events,
            rejectedPeaks,
            hitDiagnostics,
            durationMs,
            toleranceMs: toleranceRef.current,
            bpm: bpmRef.current,
            subdivision: subdivisionRef.current,
            tripletTarget: tripletTargetRef.current,
            sixteenthTarget: sixteenthTargetRef.current,
            waveform: waveformRef.current,
            maxBars: maxBarsRef.current,
            leadInMs: leadInMsRef.current,
          });
        }

        sessionStartRef.current = null;
        sessionStartHostMsRef.current = null;
        onsetTimesRef.current = [];
        onsetStrengthsRef.current = [];
        waveformRef.current = [];
        waveformStartRef.current = null;
        leadInMsRef.current = 0;
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
        {t("syncRecorder.inputAudio")}
      </Text>

      {permissionDenied ? (
        <View
          style={{ height: WAVEFORM_PANEL_HEIGHT }}
          className="items-center justify-center"
        >
          <Text className="text-white text-center text-sm px-4">
            {t("syncRecorder.micNotAuthorized")}
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

      <Text className="text-neutral-600 text-xs leading-4">
        {t("syncRecorder.tip")}
      </Text>
    </DarkPanel>
  );
}
