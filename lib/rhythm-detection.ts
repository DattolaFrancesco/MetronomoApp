// Pure rhythm/onset-detection logic, extracted out of components/sync-recorder.tsx
// so it can be unit tested without touching React, hooks, or the microphone.
// Every export here is a plain function/constant: same inputs always produce
// the same outputs, no side effects. The component still owns everything
// that *isn't* pure (mic access, refs, timers, useEffect) and imports this
// module for the actual math.

// ---- Domain types ----

// Rhythmic subdivision selected on the setup screen — how many equal
// sub-beats each native quarter-note beat is split into for onset-capture
// purposes. The native engine only ever fires onBeat once per quarter, so
// every subdivision beyond "quarter" is purely a JS-side windowing scheme:
// each onBeat opens `steps` evenly-spaced capture windows across that one
// quarter's interval instead of just one.
export type Subdivision = "quarter" | "eighth" | "triplet" | "sixteenth";

// Which of the triplet's two off-beat notes (the 2nd or 3rd note of the
// triplet — the 1st always coincides with the quarter/battere, so it's
// never a selectable target) is evaluated when subdivision is "triplet".
// Irrelevant for every other subdivision. 1-indexed as shown to the user
// ("2" / "3"); internally that's sub-beat index 1 or 2 (0 = the quarter).
export type TripletTarget = 2 | 3;

// Same idea as TripletTarget, for "sixteenth": which of the 2nd/3rd/4th
// sixteenth note is evaluated — the 1st always coincides with the
// quarter/battere, so (like TripletTarget) it's never a selectable target.
// Irrelevant for every other subdivision. 1-indexed as shown to the user;
// internally that's sub-beat index 1, 2, or 3 (0 = the quarter).
export type SixteenthTarget = 2 | 3 | 4;

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

// Per-expected-hit diagnostic snapshot — one entry per point analyzeSession
// actually searched for (every quarter, or every evaluated sub-beat for
// eighth/triplet/sixteenth), whether or not it ended up an accepted
// OnsetEvent. Debug-only: lets the debug screen show *why* a given quarter
// has no red onset line, instead of just its absence. candidateAmplitude/
// candidateRise describe the single loudest raw bucket found in that hit's
// search window (excluding buckets already claimed by a neighboring hit) —
// regardless of whether that bucket actually cleared either threshold — so
// a miss can be told apart as "too quiet" vs "no real rise" vs "nothing
// there at all" (candidateAmplitude null).
export type HitDiagnostic = {
  beatIndex: number;
  subBeatIndex: number;
  expectedTimeMs: number;
  matched: boolean;
  // Waveform bucket index this hit's peak was found at (null when
  // unmatched) — lets a caller that scores several analyzeSession calls
  // against the same continuous waveform (see scoreChallenge) carry
  // forward which buckets a previous call already spent, so a later call's
  // search window can't re-claim the same physical peak. See claimedBuckets
  // below / analyzeSession's excludedBuckets parameter.
  bucket: number | null;
  deltaMs: number | null;
  status: OnsetStatus | null;
  candidateAmplitude: number | null;
  candidateRise: number | null;
  passedAmplitude: boolean;
  passedRise: boolean;
};

export type SessionSummary = {
  events: OnsetEvent[];
  // Every candidate peak that had a beat's capture window open but didn't
  // end up accepted — debug-chart only. See RejectedPeak/PeakRejectReason.
  rejectedPeaks: RejectedPeak[];
  // One diagnostic snapshot per expected hit, matched or not — see
  // HitDiagnostic.
  hitDiagnostics: HitDiagnostic[];
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
  // Which sixteenth note was the evaluation target (see SixteenthTarget) —
  // meaningless when subdivision isn't "sixteenth", but always present for
  // the same reason as tripletTarget above.
  sixteenthTarget: SixteenthTarget;
  // Decimated amplitude history for the whole session, one entry per
  // WAVEFORM_SAMPLE_INTERVAL_MS bucket, for drawing the static full-session
  // waveform in the report. Index i covers [i, i+1) * WAVEFORM_SAMPLE_INTERVAL_MS
  // elapsed ms, same time base as OnsetEvent.elapsedMs.
  waveform: number[];
  // Number of bars chosen on the setup screen (see maxBars on SyncRecorder)
  // — debug-chart only, so it renders exactly that many bar rows instead of
  // inferring a count from durationMs, which always overshoots slightly
  // (recording continues a bit past the last beat before Stop tears
  // everything down) and would otherwise draw a spurious, mostly-empty
  // extra row. Undefined only if the session had no fixed bar limit.
  maxBars: number | undefined;
  // How much earlier than elapsedMs=0 (the first quarter) the waveform
  // array actually starts — see analyzeSession's leadInMs parameter. Also
  // used by the debug chart to know how far back real pre-roll data
  // extends before the first bar.
  leadInMs: number;
};

// ---- Constants ----

export const DEFAULT_TOLERANCE_MS = 90;

export const BEATS_PER_BAR = 4;

export const SUBDIVISION_STEPS: Record<Subdivision, number> = {
  quarter: 1,
  eighth: 2,
  triplet: 3,
  sixteenth: 4,
};

// Minimum normalized amplitude (0-1 on a SILENCE_FLOOR_DB..0dB scale) for a
// sample to count as a real onset — clearly above a quiet room's background
// noise floor, but low enough that normally-played instruments (e.g. an
// acoustic guitar picked at a moderate, sustained volume, not just sharp
// percussive transients like a handclap) still clear it reliably. Anything
// under this is treated as ambient noise and ignored everywhere (status
// flash, waveform accent, report).
export const MIN_PEAK_AMPLITUDE = 0.3;

// Minimum amplitude gain (same 0-1 normalized scale) from a local trough up
// to a following local peak, for that peak to count as a genuine new attack
// in findOnsetPeaks — not just the previous hit's own decay tail, which can
// still be louder than MIN_PEAK_AMPLITUDE (and even louder than the next
// hit's real, softer attack) well into the next beat's search window,
// especially at wide search radii (e.g. plain quarters, where the window
// spans half a beat interval each side). Measured trough-to-peak rather
// than step-to-step between adjacent buckets, because a real attack's rate
// of rise typically tapers off right at its summit — the single last step
// up to the loudest bucket is often smaller than this threshold even
// though the overall rise from the trough clearly isn't, and comparing
// only consecutive buckets would then flag some earlier, quieter point on
// the way up instead of the actual peak. Raise this if decaying tails
// still get picked; lower it if real (especially soft or
// gradually-attacked) hits start getting missed entirely.
export const MIN_ONSET_RISE = 0.08;

// Decimated (bucket-max) amplitude history kept for the full-session
// waveform shown later in the report — far coarser than the live poll rate
// so a long session doesn't balloon memory, while still keeping each
// bucket's loudest sample so transient hits stay visible.
export const WAVEFORM_SAMPLE_INTERVAL_MS = 50;

// The mic also picks up the metronome's own click from the phone speaker.
// We know the exact instant the native engine fires each click (the onBeat
// timestamp), so samples are gated out for a short window right after it —
// see isWithinClickGate/extendClickGate.
export const CLICK_GATE_MS = 18;
// CLICK_GATE_MS alone only covers the click's initial transient — without
// headphones, the mic also picks up its room/speaker decay tail, which can
// stay above MIN_PEAK_AMPLITUDE well past 18ms. So instead of releasing the
// gate on a fixed timer, extendClickGate keeps sliding it forward in small
// increments for as long as the mic still reads above threshold, and only
// lets it close once the signal has actually dropped back down — capped so
// persistent background noise can't wedge it open indefinitely.
export const CLICK_GATE_EXTEND_MS = 20;
export const CLICK_GATE_MAX_MS = 80;

// The peak-capture window around each beat adapts to tempo, clamped to a
// sane range for very slow/fast tempos.
const WINDOW_HALF_RATIO = 0.4;
const WINDOW_HALF_MIN_MS = 60;
const WINDOW_HALF_MAX_MS = 150;
// Hard safety cap: a window may never reach past the midpoint to the next
// beat, otherwise two consecutive beats' windows could overlap at high BPM.
// This wins over the ratio and the min clamp above whenever they'd overlap.
const WINDOW_SAFETY_MARGIN_MS = 6;

// ---- Small pure helpers ----

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Which sub-beat indices within each quarter actually get an onset-capture
// window opened. "quarter" is the only case that means the native beat
// itself. "eighth", "triplet" and "sixteenth" all evaluate exactly one
// chosen off-beat — the quarter itself (sub-beat 0, "il battere") is
// skipped entirely, so it never becomes an accepted/rejected onset anywhere
// (report, debug chart). For "eighth" that off-beat is fixed (there's only
// one, "il levare", sub-beat 1); for "triplet"/"sixteenth" it's whichever
// off-beat note the user picked on the recording screen (see
// TripletTarget/SixteenthTarget).
export function evaluatedSubBeats(
  subdivision: Subdivision,
  tripletTarget: TripletTarget,
  sixteenthTarget: SixteenthTarget,
): number[] {
  switch (subdivision) {
    case "quarter":
      return [0];
    case "eighth":
      return [1];
    case "triplet":
      return [tripletTarget - 1];
    case "sixteenth":
      return [sixteenthTarget - 1];
  }
}

// Which sub-beat is the "primary" (prominent, glowing) marker in
// beat-indicator.tsx. For "quarter" this is the native quarter itself.
// "eighth", "triplet" and "sixteenth" are exceptions, matching
// evaluatedSubBeats above: since only the chosen off-beat is actually
// judged by peak detection, it's that off-beat that's drawn prominent — the
// quarter (and, for triplet/sixteenth, the other off-beat notes) stay
// visible, just demoted to the secondary/outline style. NOT used by
// debug-chart.tsx's static report grid, which deliberately keeps the
// quarter/battere itself as the prominent structural reference regardless
// of the chosen target — see the hasSubdivisionGrid branch there.
export function primarySubBeat(
  subdivision: Subdivision,
  tripletTarget: TripletTarget,
  sixteenthTarget: SixteenthTarget,
): number {
  switch (subdivision) {
    case "quarter":
      return 0;
    case "eighth":
      return 1;
    case "triplet":
      return tripletTarget - 1;
    case "sixteenth":
      return sixteenthTarget - 1;
  }
}

// Module-level (not a component-local closure) so both the live per-beat
// pipeline (approximate status banner) and analyzeSession's offline pass
// (the report's actual events/rejectedPeaks) size their capture windows
// identically, off the same formula.
export function currentWindowHalfMs(beatIntervalMs: number): number {
  const ratioBased = clamp(
    beatIntervalMs * WINDOW_HALF_RATIO,
    WINDOW_HALF_MIN_MS,
    WINDOW_HALF_MAX_MS,
  );
  const safetyCap = beatIntervalMs / 2 - WINDOW_SAFETY_MARGIN_MS;
  return Math.max(10, Math.min(ratioBased, safetyCap));
}

// ---- Expected timestamps ----

// All `steps` equally-spaced sub-beat positions within a single beat that
// starts at beatTime, for the given BPM/subdivision — regardless of which
// of them are actually evaluated (see evaluatedSubBeats). E.g. at 120 BPM
// (beatIntervalMs 500), "triplet" returns 3 points 166.67ms apart;
// "sixteenth" returns 4 points 125ms apart.
export function computeSubBeatTimestamps(
  beatTime: number,
  bpm: number,
  subdivision: Subdivision,
): number[] {
  const beatIntervalMs = 60000 / bpm;
  const steps = SUBDIVISION_STEPS[subdivision];
  const subIntervalMs = beatIntervalMs / steps;
  return Array.from({ length: steps }, (_, i) => beatTime + i * subIntervalMs);
}

export type ExpectedHit = {
  beatIndex: number;
  subBeatIndex: number;
  time: number;
};

// The full grid of expected onset timestamps actually searched for across a
// session: only the evaluated sub-beat(s) of every quarter from 0 up to (but
// not including) totalQuarters, elapsed-ms from the session/bar start. This
// is what analyzeSession's beat loop iterates over.
export function computeExpectedHits(
  bpm: number,
  subdivision: Subdivision,
  tripletTarget: TripletTarget,
  sixteenthTarget: SixteenthTarget,
  totalQuarters: number,
): ExpectedHit[] {
  const beatIntervalMs = 60000 / bpm;
  const steps = SUBDIVISION_STEPS[subdivision];
  const subIntervalMs = beatIntervalMs / steps;
  const evaluated = evaluatedSubBeats(subdivision, tripletTarget, sixteenthTarget);

  const hits: ExpectedHit[] = [];
  for (let i = 0; i < totalQuarters; i++) {
    const beatTime = i * beatIntervalMs;
    const beatIndex = i % BEATS_PER_BAR;
    for (const sub of evaluated) {
      hits.push({
        beatIndex,
        subBeatIndex: sub,
        time: beatTime + sub * subIntervalMs,
      });
    }
  }
  return hits;
}

// ---- Onset/peak selection ----

// Marks every bucket that's a genuine attack peak: reached by a rise of at
// least minOnsetRise from the closest preceding trough. Not required to be a
// local maximum — a bucket that's quieter than a neighboring bucket still
// counts, as long as it cleared the rise from its own trough. Runs once over
// the whole waveform, independent of any single beat's search window, so a
// trough that sits just outside a window still counts — that's usually
// exactly where a decaying previous hit bottoms out before the next one
// begins. See MIN_ONSET_RISE for why this is trough-to-peak, not
// step-to-step.
// Same trough-tracking pass as findOnsetPeaks, but returns the actual
// trough-to-peak rise at every bucket (0 where the bucket was still falling
// or is the running trough itself) instead of collapsing it to a boolean.
// Lets debug/diagnostic code show *how close* a candidate got to
// minOnsetRise, not just whether it cleared it — findOnsetPeaks is a thin
// wrapper around this for callers that only need the boolean.
export function computeOnsetRise(
  waveform: number[],
  minOnsetRise: number = MIN_ONSET_RISE,
): number[] {
  const rise = new Array(waveform.length).fill(0);
  let trough = waveform.length > 0 ? waveform[0] : 0;
  for (let b = 1; b < waveform.length; b++) {
    const amp = waveform[b];
    if (amp < trough) {
      trough = amp;
      continue;
    }
    rise[b] = amp - trough;
    if (rise[b] >= minOnsetRise) {
      // Start tracking the next trough fresh from here, so a slow decay
      // right after this peak doesn't get compared all the way back to the
      // old (deeper) trough for the *next* candidate peak.
      trough = amp;
    }
  }
  return rise;
}

export function findOnsetPeaks(
  waveform: number[],
  minOnsetRise: number = MIN_ONSET_RISE,
): boolean[] {
  return computeOnsetRise(waveform, minOnsetRise).map(
    (rise) => rise >= minOnsetRise,
  );
}

// Picks the loudest bucket in [firstIndex, lastIndex] that both clears
// minPeakAmplitude and is flagged in onsetPeaks (see findOnsetPeaks) —
// i.e. a genuine attack, not just any loud sample. `excluded` lets a caller
// rule out buckets already claimed by a neighboring target (see
// analyzeSession's claimedBuckets). Returns null if nothing qualifies.
export function pickPeakInRange(
  waveform: number[],
  onsetPeaks: boolean[],
  firstIndex: number,
  lastIndex: number,
  minPeakAmplitude: number = MIN_PEAK_AMPLITUDE,
  excluded?: ReadonlySet<number>,
): number | null {
  let bestAmp = 0;
  let bestIndex = -1;
  for (let b = firstIndex; b <= lastIndex; b++) {
    if (excluded?.has(b)) continue;
    if (!onsetPeaks[b]) continue;
    const amp = waveform[b];
    if (amp < minPeakAmplitude) continue;
    if (amp > bestAmp) {
      bestAmp = amp;
      bestIndex = b;
    }
  }
  return bestIndex === -1 ? null : bestIndex;
}

// ---- Outcome classification ----

export function classifyOnset(
  deltaMs: number,
  toleranceMs: number,
): OnsetStatus {
  if (Math.abs(deltaMs) <= toleranceMs) return "onTime";
  return deltaMs < 0 ? "early" : "late";
}

// ---- Click gating ----

// True while sampleTime still falls inside the metronome-click exclusion
// window (see CLICK_GATE_MS/extendClickGate) — samples in this window are
// dropped everywhere so the click's own sound can never be mistaken for the
// user's onset.
export function isWithinClickGate(
  sampleTime: number,
  gateEndTime: number,
): boolean {
  return sampleTime <= gateEndTime;
}

export function computeClickGateEnd(
  clickTime: number,
  gateMs: number = CLICK_GATE_MS,
): number {
  return clickTime + gateMs;
}

// Slides the gate's end forward while the mic is still ringing above
// MIN_PEAK_AMPLITUDE (the click's own decay tail) instead of releasing it
// on a fixed timer — capped at clickTime + maxMs so persistent background
// noise can't wedge it open indefinitely. Returns the gate unchanged once
// the level has actually dropped back below threshold.
export function extendClickGate(
  clickTime: number,
  currentGateEnd: number,
  now: number,
  amplitude: number,
  minPeakAmplitude: number = MIN_PEAK_AMPLITUDE,
  extendMs: number = CLICK_GATE_EXTEND_MS,
  maxMs: number = CLICK_GATE_MAX_MS,
): number {
  if (amplitude < minPeakAmplitude) return currentGateEnd;
  return Math.min(clickTime + maxMs, now + extendMs);
}

// ---- Full offline session analysis ----

// Post-hoc analysis over a session's decimated waveform (see
// WAVEFORM_SAMPLE_INTERVAL_MS) — no live prediction, no audio access. For
// each expected hit (see computeExpectedHits) it looks at the buckets near
// it and takes the loudest one that's also a genuine attack peak (see
// findOnsetPeaks/pickPeakInRange) — not simply the tallest bucket, which a
// previous hit's still-decaying tail could otherwise win if it hadn't
// faded below MIN_PEAK_AMPLITUDE yet by the time this window opened.
//
// `leadInMs` is how much earlier than elapsedMs=0 (the first quarter) the
// waveform array actually starts recording — a deliberate pre-roll margin
// so a hit played slightly before the first beat still gets captured
// instead of falling outside every search window. Bucket index 0
// corresponds to true time `-leadInMs`, so every lookup into `waveform`
// shifts a target time by `+leadInMs` to land on the right bucket; the
// resulting `elapsedMs`/`deltaMs` on each event are converted back to
// being relative to the true first beat, same as when leadInMs is 0.
export function analyzeSession(
  waveform: number[],
  durationMs: number,
  bpm: number,
  subdivision: Subdivision,
  tripletTarget: TripletTarget,
  sixteenthTarget: SixteenthTarget,
  toleranceMs: number,
  maxBars: number | undefined,
  leadInMs = 0,
  // Buckets a previous, separate analyzeSession call over this same
  // waveform already claimed — passed in by scoreChallenge across
  // consecutive bar-scoped calls so a bar's first hit can't grab a peak
  // that actually belongs to the tail end of the previous bar (the two can
  // sit as close as matchRadius apart, e.g. Upbeat 4 → Quarter 1 in
  // "levare-poi-battere"). Empty for every other caller (free mode,
  // tests), so this is a no-op everywhere except scoreChallenge.
  excludedBuckets: ReadonlySet<number> = new Set(),
  // True-time ceiling (same 0-based coordinate as targetTime/durationMs) no
  // hit's search window may reach past, regardless of matchRadius — set by
  // scoreChallenge to the end of the current bar for every bar except the
  // last, so a bar's own last hit can't reach forward into the *next*
  // bar's territory and grab whichever of its hits happens to be louder
  // (e.g. an accented downbeat sitting right at the edge of the previous
  // bar's last levare — same matchRadius-apart pairing as excludedBuckets
  // above, just the mirror direction: this guards the search *before* it's
  // made, excludedBuckets cleans up *after*). Left at Infinity (no ceiling)
  // for every other caller and for a challenge's actual final bar, which
  // still needs to reach into the recorder's real post-roll tail.
  maxSearchTimeMs = Infinity,
): {
  events: OnsetEvent[];
  rejectedPeaks: RejectedPeak[];
  hitDiagnostics: HitDiagnostic[];
} {
  const events: OnsetEvent[] = [];
  const rejectedPeaks: RejectedPeak[] = [];
  const hitDiagnostics: HitDiagnostic[] = [];

  const beatIntervalMs = 60000 / bpm;
  if (
    !Number.isFinite(beatIntervalMs) ||
    beatIntervalMs <= 0 ||
    waveform.length === 0
  ) {
    return { events, rejectedPeaks, hitDiagnostics };
  }

  const riseByBucket = computeOnsetRise(waveform);
  const onsetPeaks = riseByBucket.map((rise) => rise >= MIN_ONSET_RISE);

  // Every subdivision now evaluates exactly one sub-beat position per
  // quarter (see evaluatedSubBeats) — that single chosen position recurs
  // once per beat, so the search radius is always half the beat interval;
  // the bars searched near one point of interest never reach past halfway
  // to the neighboring one.
  const matchRadius = beatIntervalMs / 2;

  // The number of real quarters the metronome actually played. When
  // maxBars is known (always, in practice — the setup screen requires
  // picking 1-4 bars) this is exact: maxBars * BEATS_PER_BAR, no more, no
  // less. Deriving it instead from durationMs (recording continues a
  // little past the last beat before Stop actually tears everything down,
  // so durationMs is always a bit longer than beatIntervalMs * realCount)
  // used to round up to one phantom extra quarter that was never actually
  // played — if any residual sound (the last real hit's own decay tail,
  // room noise) fell inside that phantom quarter's search window, it
  // surfaced as a spurious extra event (e.g. "5 hits" for 4 real beats).
  const totalQuarters =
    maxBars != null
      ? maxBars * BEATS_PER_BAR
      : Math.ceil(durationMs / beatIntervalMs) + 1;

  const expectedHits = computeExpectedHits(
    bpm,
    subdivision,
    tripletTarget,
    sixteenthTarget,
    totalQuarters,
  ).filter((hit) => hit.time <= durationMs + beatIntervalMs);

  let eventId = 0;
  // A bucket already credited to one point of interest can't also be
  // "the peak" for a neighboring one — without this, two adjacent targets
  // whose search windows touch at the boundary (e.g. two consecutive
  // quarters at a very fast tempo) can both independently land on the
  // exact same real peak and each report it as their own hit, drawing two
  // onset lines for what was actually a single hit.
  const claimedBuckets = new Set<number>(excludedBuckets);

  for (const hit of expectedHits) {
    const targetTime = hit.time;
    // Waveform-space time: bucket index 0 is `-leadInMs` in true (elapsedMs)
    // time, so every true target time needs +leadInMs to find its bucket.
    const targetTimeInWaveform = targetTime + leadInMs;
    const firstBucket = Math.max(
      0,
      Math.floor(
        (targetTimeInWaveform - matchRadius) / WAVEFORM_SAMPLE_INTERVAL_MS,
      ),
    );
    const windowEndTrueTime = Math.min(
      targetTime + matchRadius,
      maxSearchTimeMs,
    );
    const lastBucket = Math.min(
      waveform.length - 1,
      Math.ceil(
        (windowEndTrueTime + leadInMs) / WAVEFORM_SAMPLE_INTERVAL_MS,
      ),
    );

    // Diagnostic candidates — computed before this hit's own pick is added
    // to claimedBuckets below, so they only ever exclude buckets a
    // *different* hit already claimed. Tracked as two independent bests,
    // not one bucket's two numbers: the loudest bucket in the window is
    // often still on a previous hit's decaying tail (still going down, so
    // its own rise is 0), while the actual rising attack nearby can be
    // quieter and land on a different bucket entirely. Reporting only the
    // loudest bucket's rise would then misleadingly show 0 even when a real
    // (if too-quiet-to-win-the-loudness-contest) rise happened right there.
    let diagAmp: number | null = null;
    let bestRise: number | null = null;
    for (let b = firstBucket; b <= lastBucket; b++) {
      if (claimedBuckets.has(b)) continue;
      const amp = waveform[b];
      if (diagAmp === null || amp > diagAmp) {
        diagAmp = amp;
      }
      const rise = riseByBucket[b];
      if (bestRise === null || rise > bestRise) {
        bestRise = rise;
      }
    }

    const bestBucket = pickPeakInRange(
      waveform,
      onsetPeaks,
      firstBucket,
      lastBucket,
      MIN_PEAK_AMPLITUDE,
      claimedBuckets,
    );

    let deltaMs: number | null = null;
    let status: OnsetStatus | null = null;
    if (bestBucket !== null) {
      claimedBuckets.add(bestBucket);

      // Converted back out of waveform-space so deltaMs/elapsedMs stay
      // relative to the true first beat regardless of leadInMs.
      const peakTime = bestBucket * WAVEFORM_SAMPLE_INTERVAL_MS - leadInMs;
      deltaMs = peakTime - targetTime;
      status = classifyOnset(deltaMs, toleranceMs);
      events.push({
        id: eventId++,
        elapsedMs: targetTime,
        deltaMs,
        status,
        beatIndex: hit.beatIndex,
        subBeatIndex: hit.subBeatIndex,
        amplitude: waveform[bestBucket],
      });
    }

    hitDiagnostics.push({
      beatIndex: hit.beatIndex,
      subBeatIndex: hit.subBeatIndex,
      expectedTimeMs: targetTime,
      matched: bestBucket !== null,
      bucket: bestBucket,
      deltaMs,
      status,
      candidateAmplitude: diagAmp,
      candidateRise: bestRise,
      passedAmplitude: diagAmp !== null && diagAmp >= MIN_PEAK_AMPLITUDE,
      passedRise: bestRise !== null && bestRise >= MIN_ONSET_RISE,
    });
  }

  return { events, rejectedPeaks, hitDiagnostics };
}
