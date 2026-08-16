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
  type HitDiagnostic,
  type SixteenthTarget,
  type Subdivision,
  type TripletTarget,
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

export type ChallengeResult = {
  passed: boolean;
  hits: ChallengeHitResult[];
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

    for (const { segment, quarterIndices } of groups.values()) {
      const { hitDiagnostics } = analyzeSession(
        waveform,
        barDurationMs,
        bpm,
        segment.subdivision,
        segment.tripletTarget,
        segment.sixteenthTarget,
        challenge.toleranceMs,
        1,
        leadInMs + barIndex * barDurationMs,
        previousBarBuckets,
      );

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

    previousBarBuckets = thisBarBuckets;
  }

  const orderedHits = hits.filter(
    (h): h is ChallengeHitResult => h !== undefined,
  );
  return { passed: orderedHits.every((h) => h.onTime), hits: orderedHits };
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
