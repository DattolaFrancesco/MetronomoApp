// Challenge definitions and scoring — built entirely on top of the same
// pure engine free sessions use (lib/rhythm-detection.ts), never modifying
// it. A challenge just runs analyzeSession once per "phase" of the
// performance (here: one bar of quarters, then one bar of the eighth's
// levare) against the same recorded waveform, instead of once for the
// whole session the way free mode does.

import { analyzeSession, BEATS_PER_BAR, type HitDiagnostic } from "./rhythm-detection";

export type ChallengeDifficulty = "facile" | "medio" | "difficile";

export type Challenge = {
  id: "battere-poi-levare";
  name: string;
  difficulty: ChallengeDifficulty;
  description: string;
};

// Fixed for this challenge, deliberately not the same as free mode's own
// setup-screen bars picker or DEFAULT_TOLERANCE_MS — a challenge is a
// specific, non-configurable exercise.
export const CHALLENGE_BARS = 2;
export const CHALLENGE_TOLERANCE_MS = 80;

// Ordered easiest to hardest — new challenges should be inserted in
// difficulty order, not appended, so the list stays sorted without extra
// UI-side sorting logic.
export const CHALLENGES: Challenge[] = [
  {
    id: "battere-poi-levare",
    name: "Battere → Levare",
    difficulty: "facile",
    description:
      "Una battuta sul battere (i quarti), poi subito una battuta sul levare (gli ottavi in levare).",
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

// Scores the "Battere → Levare" challenge against a single continuous
// 2-bar recording (see CHALLENGE_BARS): bar 1 must land on the 4 quarters
// (battere, same detection as free "Quarti"), bar 2 on the 4 off-beat
// eighths (levare, same detection as free "Ottavi"). Passes only if all 8
// expected hits are matched *and* within CHALLENGE_TOLERANCE_MS.
//
// Reuses analyzeSession exactly as-is, called twice over two different
// windows of the same waveform instead of once for the whole session.
// Shifting the second call's leadInMs forward by one bar's duration makes
// analyzeSession treat bar 2's own first quarter as its "beat 0" — from
// its point of view it's an ordinary independent 1-bar "Ottavi" session,
// it has no idea a first bar preceded it.
export function scoreBattereLevareChallenge(
  waveform: number[],
  bpm: number,
  leadInMs: number,
): ChallengeResult {
  const beatIntervalMs = 60000 / bpm;
  const barDurationMs = beatIntervalMs * BEATS_PER_BAR;

  const bar1 = analyzeSession(
    waveform,
    barDurationMs,
    bpm,
    "quarter",
    2,
    2,
    CHALLENGE_TOLERANCE_MS,
    1,
    leadInMs,
  );
  const bar2 = analyzeSession(
    waveform,
    barDurationMs,
    bpm,
    "eighth",
    2,
    2,
    CHALLENGE_TOLERANCE_MS,
    1,
    leadInMs + barDurationMs,
  );

  const hits: ChallengeHitResult[] = [
    ...bar1.hitDiagnostics.map((h, i) => toHitResult(`Quarto ${i + 1}`, h)),
    ...bar2.hitDiagnostics.map((h, i) => toHitResult(`Levare ${i + 1}`, h)),
  ];

  return { passed: hits.every((h) => h.onTime), hits };
}
