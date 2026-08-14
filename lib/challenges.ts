// Challenge definitions and scoring — built entirely on top of the same
// pure engine free sessions use (lib/rhythm-detection.ts), never modifying
// it. A challenge just runs analyzeSession once per bar of the
// performance, each bar its own subdivision/target (see ChallengePhase),
// against the same recorded waveform, instead of once for the whole
// session the way free mode does.

import {
  analyzeSession,
  BEATS_PER_BAR,
  type HitDiagnostic,
  type SixteenthTarget,
  type Subdivision,
  type TripletTarget,
} from "./rhythm-detection";

export type ChallengeDifficulty = "facile" | "medio" | "difficile";

// One bar's worth of evaluation — the exact same subdivision/target
// combination free mode already validates (see evaluatedSubBeats in
// rhythm-detection.ts). tripletTarget/sixteenthTarget are only meaningful
// for "triplet"/"sixteenth" respectively, same convention as
// SessionSummary — always present so callers never special-case their
// absence. `label` prefixes that bar's 4 hit results in the report (e.g.
// "Quarto 1".."Quarto 4").
export type ChallengePhase = {
  subdivision: Subdivision;
  tripletTarget: TripletTarget;
  sixteenthTarget: SixteenthTarget;
  label: string;
};

export type ChallengeId =
  | "battere-poi-levare"
  | "battere-poi-sedicesimo2"
  | "levare-poi-sedicesimo2";

export type Challenge = {
  id: ChallengeId;
  name: string;
  difficulty: ChallengeDifficulty;
  description: string;
  // Exactly CHALLENGE_BARS phases, one per bar, evaluated in order.
  phases: [ChallengePhase, ChallengePhase];
};

// Fixed for every challenge, deliberately not the same as free mode's own
// setup-screen bars picker or DEFAULT_TOLERANCE_MS — a challenge is a
// specific, non-configurable exercise.
export const CHALLENGE_BARS = 2;
export const CHALLENGE_TOLERANCE_MS = 80;

// Shared phase building blocks — reused across challenges below instead of
// re-declaring the same subdivision/target/label combination twice.
const BATTERE: ChallengePhase = {
  subdivision: "quarter",
  tripletTarget: 2,
  sixteenthTarget: 2,
  label: "Quarto",
};
const LEVARE: ChallengePhase = {
  subdivision: "eighth",
  tripletTarget: 2,
  sixteenthTarget: 2,
  label: "Levare",
};
const SEDICESIMO_2: ChallengePhase = {
  subdivision: "sixteenth",
  tripletTarget: 2,
  sixteenthTarget: 2,
  label: "Sedicesimo-2",
};

// Ordered easiest to hardest — new challenges should be inserted in
// difficulty order, not appended, so the list stays sorted without extra
// UI-side sorting logic. "2° Sedicesimo" (the "e" of "1-e-&-a", 1/4 into
// the beat) is a less intuitive subdivision to feel accurately than
// "Levare" (the "&", the beat's exact midpoint and the most familiar
// off-beat in music) — that's why both sixteenth-note challenges rank
// above the eighth-note one, and why swapping the *first* bar's easy
// "Battere" for the harder "Levare" (battere-poi-sedicesimo2 →
// levare-poi-sedicesimo2) ranks hardest of the three.
export const CHALLENGES: Challenge[] = [
  {
    id: "battere-poi-levare",
    name: "Battere → Levare",
    difficulty: "facile",
    description:
      "Una battuta sul battere (i quarti), poi subito una battuta sul levare (gli ottavi in levare).",
    phases: [BATTERE, LEVARE],
  },
  {
    id: "battere-poi-sedicesimo2",
    name: "Battere → 2° Sedicesimo",
    difficulty: "medio",
    description:
      "Una battuta sul battere (i quarti), poi subito una battuta sul secondo sedicesimo di ogni quarto.",
    phases: [BATTERE, SEDICESIMO_2],
  },
  {
    id: "levare-poi-sedicesimo2",
    name: "Levare → 2° Sedicesimo",
    difficulty: "difficile",
    description:
      "Una battuta sul levare (gli ottavi in levare), poi subito una battuta sul secondo sedicesimo di ogni quarto.",
    phases: [LEVARE, SEDICESIMO_2],
  },
];

export type ChallengeHitResult = {
  label: string;
  onTime: boolean;
};

export type ChallengeResult = {
  passed: boolean;
  hits: ChallengeHitResult[];
};

function toHitResult(label: string, hit: HitDiagnostic): ChallengeHitResult {
  return { label, onTime: hit.matched && hit.status === "onTime" };
}

// Scores any challenge (see Challenge.phases) against a single continuous
// CHALLENGE_BARS-bar recording — one analyzeSession call per phase/bar,
// exactly as free mode's own subdivisions already work, just applied to
// one bar at a time instead of the whole session. Passes only if every
// expected hit across every phase is matched *and* within
// CHALLENGE_TOLERANCE_MS.
//
// Shifting each phase's leadInMs forward by however many bars came before
// it makes analyzeSession treat that bar's own first quarter as its
// "beat 0" — from its point of view it's an ordinary independent 1-bar
// session, it has no idea any earlier bars preceded it.
export function scoreChallenge(
  challenge: Challenge,
  waveform: number[],
  bpm: number,
  leadInMs: number,
): ChallengeResult {
  const beatIntervalMs = 60000 / bpm;
  const barDurationMs = beatIntervalMs * BEATS_PER_BAR;

  const hits: ChallengeHitResult[] = [];
  challenge.phases.forEach((phase, barIndex) => {
    const { hitDiagnostics } = analyzeSession(
      waveform,
      barDurationMs,
      bpm,
      phase.subdivision,
      phase.tripletTarget,
      phase.sixteenthTarget,
      CHALLENGE_TOLERANCE_MS,
      1,
      leadInMs + barIndex * barDurationMs,
    );
    hitDiagnostics.forEach((hit, i) => {
      hits.push(toHitResult(`${phase.label} ${i + 1}`, hit));
    });
  });

  return { passed: hits.every((h) => h.onTime), hits };
}
