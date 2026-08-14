import { SUBDIVISION_STEPS } from "./rhythm-detection";
import {
  CHALLENGES,
  challengeBars,
  scoreChallenge,
  type Challenge,
  type ChallengeSegment,
} from "./challenges";

// 120 BPM: beatIntervalMs = 500 — used throughout so every challenge's
// target timestamps land on tidy numbers.
const BPM = 120;
const LEAD_IN_MS = 100; // pre-roll so the very first hit has a real trough to rise from

function getChallenge(id: Challenge["id"]): Challenge {
  const challenge = CHALLENGES.find((c) => c.id === id);
  if (!challenge) throw new Error(`missing challenge fixture: ${id}`);
  return challenge;
}

function subBeatIndexFor(segment: ChallengeSegment): number {
  switch (segment.subdivision) {
    case "quarter":
      return 0;
    case "eighth":
      return 1;
    case "triplet":
      return segment.tripletTarget - 1;
    case "sixteenth":
      return segment.sixteenthTarget - 1;
  }
}

// The exact expected timestamp (ms, session-relative) for a given
// absolute quarter index under its own segment's subdivision/target —
// same formula the engine itself uses (computeSubBeatTimestamps in
// rhythm-detection.ts), kept independent here so the fixture doesn't
// silently rely on the thing under test.
function targetTimeMs(absoluteQuarter: number, segment: ChallengeSegment): number {
  const beatIntervalMs = 60000 / BPM;
  const subIntervalMs = beatIntervalMs / SUBDIVISION_STEPS[segment.subdivision];
  return absoluteQuarter * beatIntervalMs + subBeatIndexFor(segment) * subIntervalMs;
}

function allTargetsMs(challenge: Challenge): number[] {
  return challenge.quarterSegments.map((segment, q) => targetTimeMs(q, segment));
}

// Rounds to the nearest 50ms bucket rather than requiring exact alignment
// — being off by up to 25ms this way is comfortably inside every
// challenge's tolerance (the tightest, 60ms, still has margin to spare),
// so it doesn't affect pass/fail, only keeps the fixture simple for
// subdivisions whose targets don't land on the waveform's 50ms grid.
// Long enough to comfortably cover the longest challenge (3 bars, whose
// last target lands well past 5s at 120 BPM) with margin for the search
// window past it.
function buildWaveform(hitTimesMs: number[], leadInMs: number = LEAD_IN_MS): number[] {
  const waveform = new Array(220).fill(0.05);
  for (const t of hitTimesMs) {
    waveform[Math.round((t + leadInMs) / 50)] = 0.9;
  }
  return waveform;
}

describe("CHALLENGES — data", () => {
  test("8 challenges, ordered easiest to hardest, with the expected per-tier tolerance", () => {
    expect(CHALLENGES.map((c) => c.id)).toEqual([
      "battere-poi-levare",
      "levare-poi-battere",
      "battere-poi-sedicesimo2",
      "battere-poi-terzina3",
      "levare-poi-sedicesimo2",
      "terzina2-poi-sedicesimo3",
      "battere-levare-terzina3",
      "alternanza-battuta",
    ]);
    expect(CHALLENGES.map((c) => c.difficulty)).toEqual([
      "facile", "facile",
      "medio", "medio",
      "difficile", "difficile",
      "expert", "expert",
    ]);
    expect(CHALLENGES.map((c) => c.toleranceMs)).toEqual([
      90, 90, 80, 80, 70, 70, 60, 60,
    ]);
  });

  test("challengeBars derives the right bar count for a 2-bar, a 3-bar, and the single-bar challenge", () => {
    expect(challengeBars(getChallenge("battere-poi-levare"))).toBe(2);
    expect(challengeBars(getChallenge("battere-levare-terzina3"))).toBe(3);
    expect(challengeBars(getChallenge("alternanza-battuta"))).toBe(1);
  });

  test("every challenge's quarterSegments length is a multiple of 4 (whole bars only)", () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.quarterSegments.length % 4).toBe(0);
    }
  });
});

describe("scoreChallenge — battere-poi-levare (tolerance raised from 80ms to 90ms)", () => {
  const challenge = getChallenge("battere-poi-levare");

  // These two use a bespoke leadIn per test (instead of the shared
  // LEAD_IN_MS) chosen so the offset under test lands exactly on the
  // waveform's 50ms grid — buildWaveform's usual ±25ms rounding slop would
  // otherwise make an 85ms/95ms offset unreliable this close to the 90ms
  // tolerance boundary they're specifically meant to probe.
  test("a hit 85ms off still counts on time at the new 90ms tolerance", () => {
    const localLeadInMs = 65; // (0 + 85 + 65) / 50 = 3 exactly
    const targets = allTargetsMs(challenge);
    const waveform = buildWaveform(targets, localLeadInMs);
    waveform[Math.round((targets[0] + localLeadInMs) / 50)] = 0.05;
    waveform[(targets[0] + 85 + localLeadInMs) / 50] = 0.9;

    const result = scoreChallenge(challenge, waveform, BPM, localLeadInMs);
    expect(result.hits[0].onTime).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("a hit 95ms off is outside the 90ms tolerance", () => {
    const localLeadInMs = 55; // (0 + 95 + 55) / 50 = 3 exactly
    const targets = allTargetsMs(challenge);
    const waveform = buildWaveform(targets, localLeadInMs);
    waveform[Math.round((targets[0] + localLeadInMs) / 50)] = 0.05;
    waveform[(targets[0] + 95 + localLeadInMs) / 50] = 0.9;

    const result = scoreChallenge(challenge, waveform, BPM, localLeadInMs);
    expect(result.hits[0].onTime).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe("scoreChallenge — levare-poi-battere (same pair as facile-1, reversed order)", () => {
  const challenge = getChallenge("levare-poi-battere");

  test("passes when bar 1 lands on the levare and bar 2 on the battere", () => {
    // Bar 1's last hit (Levare 4) and bar 2's first (Quarto 1) sit exactly
    // matchRadius (half a beat) apart — the one bar-boundary pairing in
    // this whole suite where a single-bucket synthetic spike creates a
    // genuine amplitude tie between two *different* bars' search windows.
    // pickPeakInRange (rhythm-detection.ts) deliberately keeps the first
    // candidate found on a tie, so without this nudge bar 2's search would
    // grab bar 1's hit instead of its own. Nudging Levare 4 30ms early
    // (well inside the 90ms tolerance, so it's still clearly "on time")
    // breaks the tie — real playing would never land on that exact
    // boundary in the first place.
    const targets = allTargetsMs(challenge);
    targets[3] -= 30;

    const result = scoreChallenge(challenge, buildWaveform(targets), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Levare 1", "Levare 2", "Levare 3", "Levare 4",
      "Quarto 1", "Quarto 2", "Quarto 3", "Quarto 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("playing the battere in bar 1 instead of the levare does not pass that bar", () => {
    const wrongBar1 = [0, 500, 1000, 1500]; // battere positions, not levare
    const bar2 = allTargetsMs(challenge).slice(4);
    const result = scoreChallenge(challenge, buildWaveform([...wrongBar1, ...bar2]), BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 4).every((h) => h.onTime)).toBe(false);
    expect(result.hits.slice(4).every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe("scoreChallenge — battere-poi-terzina3 and terzina2-poi-sedicesimo3 (new triplet-based pairings)", () => {
  test("battere-poi-terzina3 passes when bar 2 lands on the triplet's 3rd note", () => {
    const challenge = getChallenge("battere-poi-terzina3");
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarto 1", "Quarto 2", "Quarto 3", "Quarto 4",
      "Terzina-3 1", "Terzina-3 2", "Terzina-3 3", "Terzina-3 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("terzina2-poi-sedicesimo3 passes when bar 1 lands on the triplet's 2nd note and bar 2 on the 3rd sixteenth", () => {
    const challenge = getChallenge("terzina2-poi-sedicesimo3");
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Terzina-2 1", "Terzina-2 2", "Terzina-2 3", "Terzina-2 4",
      "Sedicesimo-3 1", "Sedicesimo-3 2", "Sedicesimo-3 3", "Sedicesimo-3 4",
    ]);
    expect(result.passed).toBe(true);
  });
});

describe("scoreChallenge — battere-levare-terzina3 (Expert 1, extended to 3 bars)", () => {
  const challenge = getChallenge("battere-levare-terzina3");

  test("passes when all 12 hits across the 3 bars (quarti, levare, terzina-3) land on time", () => {
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(12);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarto 1", "Quarto 2", "Quarto 3", "Quarto 4",
      "Levare 1", "Levare 2", "Levare 3", "Levare 4",
      "Terzina-3 1", "Terzina-3 2", "Terzina-3 3", "Terzina-3 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("fails if only the third bar (terzina-3) never sounds", () => {
    const targets = allTargetsMs(challenge).slice(0, 8);
    const result = scoreChallenge(challenge, buildWaveform(targets), BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 8).every((h) => h.onTime)).toBe(true);
    expect(result.hits.slice(8).every((h) => h.onTime)).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe("scoreChallenge — alternanza-battuta (Expert 2, mixed subdivision within a single bar)", () => {
  const challenge = getChallenge("alternanza-battuta");

  test("passes when quarters 1&3 land on the battere and quarters 2&4 on the 2nd sixteenth", () => {
    const targets = allTargetsMs(challenge);
    expect(targets).toEqual([0, 625, 1000, 1625]);

    const result = scoreChallenge(challenge, buildWaveform(targets), BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(4);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarto 1", "Sedicesimo-2 2", "Quarto 3", "Sedicesimo-2 4",
    ]);
    expect(result.hits.every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("playing the battere on every quarter (ignoring the alternation) only satisfies quarters 1&3", () => {
    const allBattere = [0, 500, 1000, 1500];
    const result = scoreChallenge(challenge, buildWaveform(allBattere), BPM, LEAD_IN_MS);

    expect(result.hits[0].onTime).toBe(true); // Quarto 1
    expect(result.hits[1].onTime).toBe(false); // Sedicesimo-2 2 — this quarter needed the 2nd sixteenth
    expect(result.hits[2].onTime).toBe(true); // Quarto 3
    expect(result.hits[3].onTime).toBe(false); // Sedicesimo-2 4
    expect(result.passed).toBe(false);
  });

  test("playing the 2nd sixteenth on every quarter (ignoring the alternation) only satisfies quarters 2&4", () => {
    const allSixteenth2 = [125, 625, 1125, 1625];
    const result = scoreChallenge(challenge, buildWaveform(allSixteenth2), BPM, LEAD_IN_MS);

    expect(result.hits[0].onTime).toBe(false); // Quarto 1 — this quarter needed the battere
    expect(result.hits[1].onTime).toBe(true); // Sedicesimo-2 2
    expect(result.hits[2].onTime).toBe(false); // Quarto 3
    expect(result.hits[3].onTime).toBe(true); // Sedicesimo-2 4
    expect(result.passed).toBe(false);
  });
});
