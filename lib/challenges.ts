// Challenge definitions and scoring — built entirely on top of the same
// pure engine free sessions use (lib/rhythm-detection.ts), never modifying
// it, and entirely independent of sync-recorder.tsx: SyncRecorder's own
// job for a challenge is just capturing the raw audio (see
// components/challenge-screen.tsx, which arms it with a throwaway
// subdivision="quarter" it never actually scores against). Every
// challenge's real verdict comes from re-analyzing that raw waveform here,
// one or more analyzeSession calls per bar — which is what makes it
// possible to assign a *different* subdivision to individual quarters
// within the same bar (see Expert 2) without ever touching the shared
// recording component.

import {
  analyzeSession,
  BEATS_PER_BAR,
  currentWindowHalfMs,
  evaluatedSubBeats,
  type ExpectedHit,
  type HitDiagnostic,
  matchTapsToExpectedHits,
  type OnsetEvent,
  type SessionSummary,
  type SixteenthTarget,
  SUBDIVISION_STEPS,
  type Subdivision,
  type TripletTarget,
  WAVEFORM_SAMPLE_INTERVAL_MS,
} from "./rhythm-detection";

export type ChallengeDifficulty = "facile" | "medio" | "difficile" | "expert";

// One quarter's worth of evaluation — the exact same subdivision/target
// combination free mode already validates (see evaluatedSubBeats in
// rhythm-detection.ts). tripletTarget/sixteenthTarget are only meaningful
// for "triplet"/"sixteenth" respectively, same convention as
// SessionSummary — always present so callers never special-case their
// absence. `label` prefixes that quarter's hit result in the report,
// numbered by its position within its own bar (e.g. "Quarto 1".."Quarto 4").
export type ChallengeSegment = {
  subdivision: Subdivision;
  tripletTarget: TripletTarget;
  sixteenthTarget: SixteenthTarget;
  label: string;
};

export type ChallengeId =
  | "battere-poi-levare"
  | "levare-poi-battere"
  | "battere-poi-sedicesimo2"
  | "battere-poi-terzina3"
  | "levare-poi-sedicesimo2"
  | "giro-sedicesimi"
  | "battere-levare-terzina3"
  | "alternanza-battuta";

export type Challenge = {
  id: ChallengeId;
  name: string;
  difficulty: ChallengeDifficulty;
  description: string;
  // Non-configurable per challenge (unlike free mode's own tolerance
  // slider) — harder challenges use a tighter tolerance.
  toleranceMs: number;
  // One entry per quarter across the whole challenge, in order. Length is
  // always a multiple of BEATS_PER_BAR (4). Most challenges just repeat
  // the same segment 4 times per bar (see the `bar` helper below); Expert
  // 2 assigns a *different* segment to individual quarters within a
  // single bar instead.
  quarterSegments: ChallengeSegment[];
};

// Building blocks reused across challenges below instead of re-declaring
// the same subdivision/target/label combination over and over.
const BATTERE: ChallengeSegment = {
  subdivision: "quarter",
  tripletTarget: 2,
  sixteenthTarget: 2,
  label: "Quarter",
};
const LEVARE: ChallengeSegment = {
  subdivision: "eighth",
  tripletTarget: 2,
  sixteenthTarget: 2,
  label: "Upbeat",
};
const SEDICESIMO_2: ChallengeSegment = {
  subdivision: "sixteenth",
  tripletTarget: 2,
  sixteenthTarget: 2,
  label: "Sixteenth-2",
};
const SEDICESIMO_3: ChallengeSegment = {
  subdivision: "sixteenth",
  tripletTarget: 2,
  sixteenthTarget: 3,
  label: "Sixteenth-3",
};
const SEDICESIMO_4: ChallengeSegment = {
  subdivision: "sixteenth",
  tripletTarget: 2,
  sixteenthTarget: 4,
  label: "Sixteenth-4",
};
const TERZINA_3: ChallengeSegment = {
  subdivision: "triplet",
  tripletTarget: 3,
  sixteenthTarget: 2,
  label: "Triplet-3",
};

// A whole bar (all 4 quarters) evaluated on the same segment — the common
// case for every challenge except Expert 2.
function bar(segment: ChallengeSegment): ChallengeSegment[] {
  return [segment, segment, segment, segment];
}

// How many bars a challenge spans, derived from its quarter count rather
// than tracked separately — SyncRecorder's own maxBars prop (see
// components/challenge-screen.tsx) needs this to know when to auto-stop.
export function challengeBars(challenge: Challenge): number {
  return challenge.quarterSegments.length / BEATS_PER_BAR;
}

// Ordered easiest to hardest — new challenges should be inserted in
// difficulty order, not appended, so the list stays sorted without extra
// UI-side sorting logic.
//
// Difficulty reasoning: "2nd sixteenth" (the "e" of "1-e-&-a", 1/4 into
// the beat) and "3rd sixteenth" (the "a", 3/4 into the beat) are both less
// intuitive to feel accurately than "upbeat" (the "&", the beat's exact
// midpoint and the most familiar off-beat in music) or a triplet note
// (a different, but still singular, evenly-spaced grid) — that's why the
// sixteenth-note pairings rank above the eighth/triplet ones within each
// tier. Expert-tier challenges either add a third bar (a longer piece to
// hold together end to end) or — harder still — change subdivision
// *within* a single bar (Expert 2), which is a much sharper mental-grid
// switch than the same change spread across a full bar's worth of beats.
export const CHALLENGES: Challenge[] = [
  {
    id: "battere-poi-levare",
    name: "Downbeat → Upbeat",
    difficulty: "facile",
    toleranceMs: 100,
    description:
      "One bar on the downbeat (the quarters), then immediately one bar on the upbeat (the off-beat eighths).",
    quarterSegments: [...bar(BATTERE), ...bar(LEVARE)],
  },
  {
    id: "levare-poi-battere",
    name: "Upbeat → Downbeat",
    difficulty: "facile",
    toleranceMs: 100,
    description:
      "The same pair as the previous challenge, but reversed: upbeat first, then immediately the downbeat.",
    quarterSegments: [...bar(LEVARE), ...bar(BATTERE)],
  },
  {
    id: "battere-poi-sedicesimo2",
    name: "Downbeat → 2nd Sixteenth",
    difficulty: "medio",
    toleranceMs: 90,
    description:
      "One bar on the downbeat (the quarters), then immediately one bar on the second sixteenth of each quarter.",
    quarterSegments: [...bar(BATTERE), ...bar(SEDICESIMO_2)],
  },
  {
    id: "battere-poi-terzina3",
    name: "Downbeat → 3rd Triplet",
    difficulty: "medio",
    toleranceMs: 90,
    description:
      "One bar on the downbeat (the quarters), then immediately one bar on the third note of each triplet.",
    quarterSegments: [...bar(BATTERE), ...bar(TERZINA_3)],
  },
  {
    id: "levare-poi-sedicesimo2",
    name: "Upbeat → 2nd Sixteenth",
    difficulty: "difficile",
    toleranceMs: 80,
    description:
      "One bar on the upbeat (the off-beat eighths), then immediately one bar on the second sixteenth of each quarter.",
    quarterSegments: [...bar(LEVARE), ...bar(SEDICESIMO_2)],
  },
  {
    id: "giro-sedicesimi",
    name: "1st → 2nd → 3rd → 4th Sixteenth",
    difficulty: "difficile",
    toleranceMs: 80,
    description:
      "Four bars in a row, one per sixteenth-note position within the beat: first the downbeat, then the second, third, and fourth sixteenth in turn.",
    quarterSegments: [
      ...bar(BATTERE),
      ...bar(SEDICESIMO_2),
      ...bar(SEDICESIMO_3),
      ...bar(SEDICESIMO_4),
    ],
  },
  {
    id: "battere-levare-terzina3",
    name: "Downbeat → Upbeat → 3rd Triplet",
    difficulty: "expert",
    toleranceMs: 70,
    description:
      "Three bars in a row, each with a different subdivision: quarters, then upbeat, then the third note of the triplet.",
    quarterSegments: [...bar(BATTERE), ...bar(LEVARE), ...bar(TERZINA_3)],
  },
  {
    id: "alternanza-battuta",
    name: "Alternating Within a Bar",
    difficulty: "expert",
    toleranceMs: 70,
    description:
      "A single bar: the 1st and 3rd quarters are played on the downbeat, the 2nd and 4th on the second sixteenth — the subdivision change happens within the same bar.",
    quarterSegments: [BATTERE, SEDICESIMO_2, BATTERE, SEDICESIMO_2],
  },
];

export type ChallengeHitResult = {
  label: string;
  onTime: boolean;
  deltaMs: number | null;
};

// One entry per analyzeSession call scoreChallenge actually made (one or,
// for a bar with more than one group — see Expert 2 — more than one per
// bar) — lets the report's Timing Analysis section reuse the same
// DebugChart free mode already has, each instance scoped to exactly the one
// bar/segment it came from instead of assuming a single subdivision spans
// the whole recording (which, for almost every challenge, isn't true).
export type ChallengeDebugGroup = {
  label: string;
  barIndex: number;
  summary: SessionSummary;
};

export type ChallengeResult = {
  passed: boolean;
  hits: ChallengeHitResult[];
  debugGroups: ChallengeDebugGroup[];
};

function segmentKey(segment: ChallengeSegment): string {
  return `${segment.subdivision}:${segment.tripletTarget}:${segment.sixteenthTarget}`;
}

// Scores any challenge (see Challenge.quarterSegments) against a single
// continuous recording of challengeBars(challenge) bars. Passes only if
// every expected hit, across every quarter, is matched *and* within
// challenge.toleranceMs.
//
// One bar at a time: within a bar, quarters are grouped by their distinct
// segment (almost always just one group — a whole bar sharing the same
// subdivision) and analyzeSession is called once per group, scoped to
// that bar via maxBars: 1 and a leadInMs shifted forward by however many
// bars came before it — from analyzeSession's point of view each call is
// an ordinary independent 1-bar session, it has no idea what (if
// anything) precedes or follows it. Only the quarters that group actually
// owns are kept from its result; a second group in the same bar (Expert
// 2) runs its own separate call over the *same* bar and only contributes
// its own quarters — the two calls' search windows can overlap in time,
// but since each only ever contributes the quarters it's actually
// responsible for, a stray match in the discarded portion of either call
// can never leak into the final result.
export function scoreChallenge(
  challenge: Challenge,
  waveform: number[],
  bpm: number,
  leadInMs: number,
): ChallengeResult {
  const beatIntervalMs = 60000 / bpm;
  const barDurationMs = beatIntervalMs * BEATS_PER_BAR;
  const totalQuarters = challenge.quarterSegments.length;
  const totalBars = challengeBars(challenge);

  // Indexed by absolute quarter (0..totalQuarters-1) so the final report
  // reads in natural performance order regardless of how many
  // analyzeSession calls it took to fill each slot.
  const hits: (ChallengeHitResult | undefined)[] = new Array(totalQuarters);

  // Buckets the previous bar's kept hits actually landed on — carried into
  // this bar's analyzeSession calls (as excludedBuckets) so this bar's
  // first hit can't re-claim a peak that belongs to the tail end of the
  // previous bar. Only ever needs to span one bar back: analyzeSession's
  // search windows never reach further than half a beat, so a bucket from
  // two bars ago is already out of reach. Reset per bar (not accumulated
  // across the whole challenge) so it never affects — and is never affected
  // by — sibling groups sharing the *same* bar (see the Expert-2 comment
  // below), only the bar that came immediately before.
  let previousBarBuckets = new Set<number>();

  const debugGroups: ChallengeDebugGroup[] = [];

  for (let barIndex = 0; barIndex < totalBars; barIndex++) {
    const barSegments = challenge.quarterSegments.slice(
      barIndex * BEATS_PER_BAR,
      barIndex * BEATS_PER_BAR + BEATS_PER_BAR,
    );

    const groups = new Map<
      string,
      { segment: ChallengeSegment; quarterIndices: number[] }
    >();
    barSegments.forEach((segment, quarterIndex) => {
      const key = segmentKey(segment);
      const group = groups.get(key);
      if (group) {
        group.quarterIndices.push(quarterIndex);
      } else {
        groups.set(key, { segment, quarterIndices: [quarterIndex] });
      }
    });

    // Buckets this bar's own kept hits land on — becomes previousBarBuckets
    // for the *next* iteration. Deliberately a fresh set per bar, filled
    // independently by every group in this bar (see the module-level
    // comment on scoreChallenge: two groups sharing a bar already run
    // fully independent analyzeSession calls, each only ever contributing
    // its own quarters — this carries that same independence forward,
    // it just also feeds the next bar).
    const thisBarBuckets = new Set<number>();

    // Every bar's search windows are capped at its own end — except the
    // very last bar, which still needs to reach into the recorder's real
    // post-roll tail (see the last-hit capture-gap fix). Without this cap,
    // a bar's own last hit's window can reach exactly as far as the next
    // bar's first hit (they can sit precisely matchRadius apart — e.g.
    // Upbeat 4 → Quarter 1 in "levare-poi-battere") and, if that next hit
    // happens to be louder (an accented downbeat is a common case), it
    // wins pickPeakInRange's "loudest wins" contest and gets wrongly
    // credited to *this* bar's hit instead.
    // The one full bucket of margin matters: a bar's last hit and the next
    // bar's first can sit at *exactly* matchRadius apart (see the comment
    // above), meaning the natural window edge and the neighboring bar's own
    // target land on the very same 50ms bucket — a plain `barDurationMs`
    // ceiling wouldn't actually exclude it (it'd still be the last bucket
    // included, just via a different arithmetic path). Backing off by one
    // whole bucket guarantees real separation regardless of tempo, since
    // WAVEFORM_SAMPLE_INTERVAL_MS is the actual granularity "touching"
    // happens at, not a fraction of the beat interval.
    const isLastBar = barIndex === totalBars - 1;
    const maxSearchTimeMs = isLastBar
      ? Infinity
      : barDurationMs - WAVEFORM_SAMPLE_INTERVAL_MS;

    // One debugGroup per *bar*, not per group — a bar is a single musical
    // moment regardless of how many analyzeSession calls it took to score
    // it (Expert 2 alone ever has more than one, see the module comment
    // above). Every group's real, owned-quarter events/diagnostics are
    // filtered down and merged into one combined summary below instead of
    // each group getting its own separate "Bar N" chart — a single-bar
    // challenge should read as one bar in the report, not as many as it
    // happened to take analyzeSession calls to score.
    const barEvents: OnsetEvent[] = [];
    const barHitDiagnostics: HitDiagnostic[] = [];
    const barLabels: string[] = [];
    // Grid decoration only (see DebugChart) — which group's subdivision to
    // draw the fine sub-beat ticks for, when the bar mixes more than one.
    // Onset line *positions* come from each event's own real elapsedMs/
    // deltaMs regardless of this choice, so it can't misrepresent where a
    // hit actually landed — it only picks which reference grid overlays a
    // mixed bar. Prefers a group with its own real grid (triplet/sixteenth)
    // over the plain quarter/eighth fallback ruler.
    let gridSegment: ChallengeSegment | null = null;

    const groupLeadInMs = leadInMs + barIndex * barDurationMs;

    for (const { segment, quarterIndices } of groups.values()) {
      const { events, hitDiagnostics } = analyzeSession(
        waveform,
        barDurationMs,
        bpm,
        segment.subdivision,
        segment.tripletTarget,
        segment.sixteenthTarget,
        challenge.toleranceMs,
        1,
        groupLeadInMs,
        previousBarBuckets,
        maxSearchTimeMs,
      );

      const ownedQuarters = new Set(quarterIndices);
      for (const event of events) {
        if (ownedQuarters.has(event.beatIndex)) barEvents.push(event);
      }
      for (const diag of hitDiagnostics) {
        if (ownedQuarters.has(diag.beatIndex)) barHitDiagnostics.push(diag);
      }
      barLabels.push(segment.label);
      if (
        gridSegment === null ||
        segment.subdivision === "triplet" ||
        segment.subdivision === "sixteenth"
      ) {
        gridSegment = segment;
      }

      for (const quarterIndex of quarterIndices) {
        const hit = hitDiagnostics.find((h) => h.beatIndex === quarterIndex);
        const absoluteQuarter = barIndex * BEATS_PER_BAR + quarterIndex;
        hits[absoluteQuarter] = toHitResult(
          `${segment.label} ${quarterIndex + 1}`,
          hit,
        );
        if (hit?.bucket != null) {
          thisBarBuckets.add(hit.bucket);
        }
      }
    }

    // DebugChart (see components/debug-chart.tsx) treats a summary's own
    // leadInMs as both "how far bucket 0 sits before this summary's local
    // elapsedMs=0" *and* "how much pre-roll padding to draw before its
    // first bar" — true together for a real, whole-session SessionSummary,
    // but groupLeadInMs above only serves the first purpose (it's however
    // many bars came before this one, not a real pre-roll margin). Passing
    // groupLeadInMs straight through would render every bar after the
    // first with a huge, wrong "pre-roll" region actually made of the
    // *previous* bar's own real audio. Slicing the shared waveform down to
    // just a small tempo-adaptive margin around this bar — and rebasing
    // leadInMs to match that slice — keeps bucket math correct while
    // giving each debug group its own honest little window.
    const margin = currentWindowHalfMs(beatIntervalMs);
    const sliceStartBucket = Math.max(
      0,
      Math.floor((groupLeadInMs - margin) / WAVEFORM_SAMPLE_INTERVAL_MS),
    );
    const sliceEndBucket = Math.min(
      waveform.length - 1,
      Math.ceil(
        (groupLeadInMs + barDurationMs + margin) / WAVEFORM_SAMPLE_INTERVAL_MS,
      ),
    );
    // gridSegment is only ever null if this bar had zero groups, which
    // can't happen — every quarter of every bar belongs to some segment.
    const grid = gridSegment!;

    debugGroups.push({
      label: barLabels.join(" / "),
      barIndex,
      summary: {
        events: barEvents,
        rejectedPeaks: [],
        hitDiagnostics: barHitDiagnostics,
        durationMs: barDurationMs,
        toleranceMs: challenge.toleranceMs,
        bpm,
        subdivision: grid.subdivision,
        tripletTarget: grid.tripletTarget,
        sixteenthTarget: grid.sixteenthTarget,
        waveform: waveform.slice(sliceStartBucket, sliceEndBucket + 1),
        maxBars: 1,
        leadInMs: groupLeadInMs - sliceStartBucket * WAVEFORM_SAMPLE_INTERVAL_MS,
      },
    });

    previousBarBuckets = thisBarBuckets;
  }

  const orderedHits = hits.filter(
    (h): h is ChallengeHitResult => h !== undefined,
  );
  return {
    passed: orderedHits.every((h) => h.onTime),
    hits: orderedHits,
    debugGroups,
  };
}

// Tap-mode counterpart to scoreChallenge — same public shape (ChallengeResult,
// one ChallengeDebugGroup per bar so ChallengeReport's DebugChart reuse
// keeps working unchanged), but matching a flat list of tap timestamps
// against the challenge's full expected-hit grid instead of re-analyzing a
// recorded waveform bar by bar.
//
// This can run as a *single* matchTapsToExpectedHits pass over the whole
// challenge, unlike scoreChallenge's incremental per-bar/per-group
// analyzeSession calls with bucket-exclusion bookkeeping (previousBarBuckets,
// maxSearchTimeMs) — all of that exists there specifically to stop two
// waveform searches from claiming the same physical audio peak, which has
// no equivalent problem here: every tap is already an unambiguous, precise
// timestamp, so one global "nearest unclaimed tap, in expected-hit order"
// pass (see matchTapsToExpectedHits) is both correct and simpler. Results
// are grouped into per-bar debugGroups afterward purely for the report UI.
export function scoreChallengeFromTaps(
  challenge: Challenge,
  tapTimesMs: number[],
  bpm: number,
): ChallengeResult {
  const beatIntervalMs = 60000 / bpm;
  const barDurationMs = beatIntervalMs * BEATS_PER_BAR;
  const totalBars = challengeBars(challenge);
  // Same reasoning as analyzeSession's own matchRadius: every subdivision
  // evaluates exactly one sub-beat per quarter, so the search never needs
  // to reach past half a beat interval either side of it.
  const matchRadius = beatIntervalMs / 2;

  // One expected-hit entry per evaluated sub-beat, built per-quarter from
  // that quarter's own segment (unlike computeExpectedHits, which assumes
  // a single subdivision for the whole call) — this is what lets a mixed-
  // segment bar (Expert 2) work for tap mode too. quarterIndex/segment ride
  // along purely so the flat match pass below can be regrouped by bar
  // afterward; matchTapsToExpectedHits itself only reads beatIndex/
  // subBeatIndex/time.
  const expectedHits: (ExpectedHit & {
    quarterIndex: number;
    segment: ChallengeSegment;
  })[] = [];
  challenge.quarterSegments.forEach((segment, quarterIndex) => {
    const beatTime = quarterIndex * beatIntervalMs;
    const steps = SUBDIVISION_STEPS[segment.subdivision];
    const subIntervalMs = beatIntervalMs / steps;
    for (const sub of evaluatedSubBeats(
      segment.subdivision,
      segment.tripletTarget,
      segment.sixteenthTarget,
    )) {
      expectedHits.push({
        beatIndex: quarterIndex % BEATS_PER_BAR,
        subBeatIndex: sub,
        time: beatTime + sub * subIntervalMs,
        quarterIndex,
        segment,
      });
    }
  });

  // hitDiagnostics[i] always corresponds to expectedHits[i] — one-to-one,
  // in order (see matchTapsToExpectedHits) — so events for the per-bar
  // debug summaries are rebuilt directly from the matched diagnostics
  // below instead of also consuming the function's own `events` return,
  // which would need the same positional bookkeeping to regroup by bar
  // anyway.
  const { hitDiagnostics } = matchTapsToExpectedHits(
    expectedHits,
    tapTimesMs,
    challenge.toleranceMs,
    matchRadius,
  );

  const hits: (ChallengeHitResult | undefined)[] = new Array(
    challenge.quarterSegments.length,
  );
  const barEvents: OnsetEvent[][] = Array.from({ length: totalBars }, () => []);
  const barHitDiagnostics: HitDiagnostic[][] = Array.from({ length: totalBars }, () => []);
  const barLabels: string[][] = Array.from({ length: totalBars }, () => []);
  const barGrid: (ChallengeSegment | null)[] = new Array(totalBars).fill(null);
  let eventId = 0;

  hitDiagnostics.forEach((diag, i) => {
    const { quarterIndex, segment } = expectedHits[i];
    const barIndex = Math.floor(quarterIndex / BEATS_PER_BAR);
    // Rebased to this bar's own local 0..barDurationMs range — matches
    // scoreChallenge's own per-bar SessionSummary, and is what lets
    // DebugChart's "is this event inside this row's [barStart, barEnd)"
    // check place it correctly. deltaMs itself needs no rebasing: it's
    // already a relative offset from the expected time, unaffected by
    // shifting both the target and the real tap time by the same amount.
    const barRelativeExpectedTimeMs = diag.expectedTimeMs - barIndex * barDurationMs;

    barHitDiagnostics[barIndex].push({
      ...diag,
      expectedTimeMs: barRelativeExpectedTimeMs,
    });
    if (diag.matched) {
      barEvents[barIndex].push({
        id: eventId++,
        elapsedMs: barRelativeExpectedTimeMs,
        deltaMs: diag.deltaMs!,
        status: diag.status!,
        beatIndex: diag.beatIndex,
        subBeatIndex: diag.subBeatIndex,
        amplitude: 1,
      });
    }

    hits[quarterIndex] = toHitResult(
      `${segment.label} ${(quarterIndex % BEATS_PER_BAR) + 1}`,
      diag,
    );

    if (!barLabels[barIndex].includes(segment.label)) {
      barLabels[barIndex].push(segment.label);
    }
    // Same "prefer a group with its own real grid" preference as
    // scoreChallenge's gridSegment above.
    if (
      barGrid[barIndex] === null ||
      segment.subdivision === "triplet" ||
      segment.subdivision === "sixteenth"
    ) {
      barGrid[barIndex] = segment;
    }
  });

  const debugGroups: ChallengeDebugGroup[] = [];
  for (let barIndex = 0; barIndex < totalBars; barIndex++) {
    const grid = barGrid[barIndex]!;
    debugGroups.push({
      label: barLabels[barIndex].join(" / "),
      barIndex,
      summary: {
        events: barEvents[barIndex],
        rejectedPeaks: [],
        hitDiagnostics: barHitDiagnostics[barIndex],
        durationMs: barDurationMs,
        toleranceMs: challenge.toleranceMs,
        bpm,
        subdivision: grid.subdivision,
        tripletTarget: grid.tripletTarget,
        sixteenthTarget: grid.sixteenthTarget,
        waveform: [],
        maxBars: 1,
        leadInMs: 0,
        inputSource: "tap",
        tapTimesMs,
      },
    });
  }

  const orderedHits = hits.filter(
    (h): h is ChallengeHitResult => h !== undefined,
  );
  return {
    passed: orderedHits.every((h) => h.onTime),
    hits: orderedHits,
    debugGroups,
  };
}

function toHitResult(
  label: string,
  hit: HitDiagnostic | undefined,
): ChallengeHitResult {
  return {
    label,
    onTime: hit !== undefined && hit.matched && hit.status === "onTime",
    deltaMs: hit?.deltaMs ?? null,
  };
}
