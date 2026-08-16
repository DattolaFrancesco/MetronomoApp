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
      100, 100, 90, 90, 80, 80, 70, 70,
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

describe("scoreChallenge — battere-poi-levare (tolerance raised from 90ms to 100ms)", () => {
  const challenge = getChallenge("battere-poi-levare");

  // These two use a bespoke leadIn per test (instead of the shared
  // LEAD_IN_MS) chosen so the offset under test lands exactly on the
  // waveform's 50ms grid — buildWaveform's usual ±25ms rounding slop would
  // otherwise make a 95ms/105ms offset unreliable this close to the 100ms
  // tolerance boundary they're specifically meant to probe.
  test("a hit 95ms off still counts on time at the new 100ms tolerance", () => {
    const localLeadInMs = 55; // (0 + 95 + 55) / 50 = 3 exactly
    const targets = allTargetsMs(challenge);
    const waveform = buildWaveform(targets, localLeadInMs);
    waveform[Math.round((targets[0] + localLeadInMs) / 50)] = 0.05;
    waveform[(targets[0] + 95 + localLeadInMs) / 50] = 0.9;

    const result = scoreChallenge(challenge, waveform, BPM, localLeadInMs);
    expect(result.hits[0].onTime).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("a hit 105ms off is outside the 100ms tolerance", () => {
    const localLeadInMs = 45; // (0 + 105 + 45) / 50 = 3 exactly
    const targets = allTargetsMs(challenge);
    const waveform = buildWaveform(targets, localLeadInMs);
    waveform[Math.round((targets[0] + localLeadInMs) / 50)] = 0.05;
    waveform[(targets[0] + 105 + localLeadInMs) / 50] = 0.9;

    const result = scoreChallenge(challenge, waveform, BPM, localLeadInMs);
    expect(result.hits[0].onTime).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe("scoreChallenge — levare-poi-battere (same pair as easy-1, reversed order)", () => {
  const challenge = getChallenge("levare-poi-battere");

  test("passes when bar 1 lands on the upbeat and bar 2 on the downbeat", () => {
    // Bar 1's last hit (Upbeat 4) and bar 2's first (Quarter 1) sit exactly
    // matchRadius (half a beat) apart — bar 2's own search window for
    // Quarter 1 reaches back far enough to touch the exact same bucket
    // Upbeat 4's own bar-1 call already claimed. Without carrying that
    // claim forward (see previousBarBuckets in scoreChallenge), bar 2's
    // call would have no way of knowing that bucket was already spent, and
    // could grab it for Quarter 1 instead of finding — or correctly
    // missing — its own real attack right at the boundary. No nudge here
    // deliberately: this is the exact scenario a real player can hit.
    const targets = allTargetsMs(challenge);

    const result = scoreChallenge(challenge, buildWaveform(targets), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Upbeat 1", "Upbeat 2", "Upbeat 3", "Upbeat 4",
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("playing the downbeat in bar 1 instead of the upbeat does not pass that bar", () => {
    const wrongBar1 = [0, 500, 1000, 1500]; // downbeat positions, not upbeat
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
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
      "Triplet-3 1", "Triplet-3 2", "Triplet-3 3", "Triplet-3 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("terzina2-poi-sedicesimo3 passes when bar 1 lands on the triplet's 2nd note and bar 2 on the 3rd sixteenth", () => {
    const challenge = getChallenge("terzina2-poi-sedicesimo3");
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Triplet-2 1", "Triplet-2 2", "Triplet-2 3", "Triplet-2 4",
      "Sixteenth-3 1", "Sixteenth-3 2", "Sixteenth-3 3", "Sixteenth-3 4",
    ]);
    expect(result.passed).toBe(true);
  });
});

describe("scoreChallenge — battere-levare-terzina3 (Expert 1, extended to 3 bars)", () => {
  const challenge = getChallenge("battere-levare-terzina3");

  test("passes when all 12 hits across the 3 bars (quarters, upbeat, triplet-3) land on time", () => {
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(12);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
      "Upbeat 1", "Upbeat 2", "Upbeat 3", "Upbeat 4",
      "Triplet-3 1", "Triplet-3 2", "Triplet-3 3", "Triplet-3 4",
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

  test("passes when quarters 1&3 land on the downbeat and quarters 2&4 on the 2nd sixteenth", () => {
    const targets = allTargetsMs(challenge);
    expect(targets).toEqual([0, 625, 1000, 1625]);

    const result = scoreChallenge(challenge, buildWaveform(targets), BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(4);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarter 1", "Sixteenth-2 2", "Quarter 3", "Sixteenth-2 4",
    ]);
    expect(result.hits.every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("playing the downbeat on every quarter (ignoring the alternation) only satisfies quarters 1&3", () => {
    const allBattere = [0, 500, 1000, 1500];
    const result = scoreChallenge(challenge, buildWaveform(allBattere), BPM, LEAD_IN_MS);

    expect(result.hits[0].onTime).toBe(true); // Quarter 1
    expect(result.hits[1].onTime).toBe(false); // Sixteenth-2 2 — this quarter needed the 2nd sixteenth
    expect(result.hits[2].onTime).toBe(true); // Quarter 3
    expect(result.hits[3].onTime).toBe(false); // Sixteenth-2 4
    expect(result.passed).toBe(false);
  });

  test("playing the 2nd sixteenth on every quarter (ignoring the alternation) only satisfies quarters 2&4", () => {
    const allSixteenth2 = [125, 625, 1125, 1625];
    const result = scoreChallenge(challenge, buildWaveform(allSixteenth2), BPM, LEAD_IN_MS);

    expect(result.hits[0].onTime).toBe(false); // Quarter 1 — this quarter needed the downbeat
    expect(result.hits[1].onTime).toBe(true); // Sixteenth-2 2
    expect(result.hits[2].onTime).toBe(false); // Quarter 3
    expect(result.hits[3].onTime).toBe(true); // Sixteenth-2 4
    expect(result.passed).toBe(false);
  });
});
