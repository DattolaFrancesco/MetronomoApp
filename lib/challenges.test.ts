import {
  CHALLENGE_BARS,
  CHALLENGE_TOLERANCE_MS,
  CHALLENGES,
  scoreChallenge,
  type Challenge,
} from "./challenges";

// 120 BPM: beatIntervalMs = 500, barDurationMs = 2000 — same for every
// challenge, regardless of subdivision (only how many sub-positions get
// evaluated *within* a bar changes, never the bar's own duration).
const BPM = 120;
const LEAD_IN_MS = 100; // pre-roll so the very first hit has a real trough to rise from

function getChallenge(id: Challenge["id"]): Challenge {
  const challenge = CHALLENGES.find((c) => c.id === id);
  if (!challenge) throw new Error(`missing challenge fixture: ${id}`);
  return challenge;
}

// Rounds to the nearest 50ms bucket rather than requiring exact alignment
// — being off by up to 25ms this way is comfortably inside every
// challenge's 80ms tolerance, so it doesn't affect pass/fail, only keeps
// the fixture simple for subdivisions whose targets (e.g. sixteenth-note
// 125ms steps) don't land on the waveform's 50ms grid.
function buildWaveform(hitTimesMs: number[]): number[] {
  const waveform = new Array(90).fill(0.05);
  for (const t of hitTimesMs) {
    waveform[Math.round((t + LEAD_IN_MS) / 50)] = 0.9;
  }
  return waveform;
}

describe("CHALLENGES — data", () => {
  test("all three challenges are defined, ordered easiest to hardest, fixed at 2 bars and 80ms tolerance", () => {
    expect(CHALLENGES.map((c) => c.id)).toEqual([
      "battere-poi-levare",
      "battere-poi-sedicesimo2",
      "levare-poi-sedicesimo2",
    ]);
    expect(CHALLENGES.map((c) => c.difficulty)).toEqual([
      "facile",
      "medio",
      "difficile",
    ]);
    expect(CHALLENGE_BARS).toBe(2);
    expect(CHALLENGE_TOLERANCE_MS).toBe(80);
  });

  test("every challenge has exactly 2 phases (one per CHALLENGE_BARS bar)", () => {
    for (const challenge of CHALLENGES) {
      expect(challenge.phases).toHaveLength(2);
    }
  });
});

describe("scoreChallenge — battere-poi-levare (bar 1 quarters, bar 2 eighth's levare)", () => {
  const challenge = getChallenge("battere-poi-levare");
  const TARGETS_MS = [0, 500, 1000, 1500, 2250, 2750, 3250, 3750];

  test("passes when all 4 battere and all 4 levare hits land on time", () => {
    const result = scoreChallenge(challenge, buildWaveform(TARGETS_MS), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarto 1", "Quarto 2", "Quarto 3", "Quarto 4",
      "Levare 1", "Levare 2", "Levare 3", "Levare 4",
    ]);
    expect(result.hits.every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("fails when a single hit misses the 80ms tolerance, even though every other hit is on time", () => {
    const waveform = buildWaveform(TARGETS_MS);
    waveform[Math.round((3750 + LEAD_IN_MS) / 50)] = 0.05;
    waveform[Math.round((3750 + 200 + LEAD_IN_MS) / 50)] = 0.9;

    const result = scoreChallenge(challenge, waveform, BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 7).every((h) => h.onTime)).toBe(true);
    expect(result.hits[7]).toEqual({ label: "Levare 4", onTime: false });
    expect(result.passed).toBe(false);
  });

  test("fails when a hit is missing entirely (silence), not just off-tolerance ones", () => {
    const result = scoreChallenge(
      challenge,
      buildWaveform(TARGETS_MS.slice(0, 7)),
      BPM,
      LEAD_IN_MS,
    );

    expect(result.hits.slice(0, 7).every((h) => h.onTime)).toBe(true);
    expect(result.hits[7]).toEqual({ label: "Levare 4", onTime: false });
    expect(result.passed).toBe(false);
  });

  test("bar 1 is evaluated as quarters (battere) and bar 2 as the eighth's levare, not the other way round", () => {
    const result = scoreChallenge(
      challenge,
      buildWaveform(TARGETS_MS.slice(0, 4)),
      BPM,
      LEAD_IN_MS,
    );

    expect(result.hits.slice(0, 4).every((h) => h.onTime)).toBe(true);
    expect(result.hits.slice(4).every((h) => h.onTime)).toBe(false);
  });
});

describe("scoreChallenge — battere-poi-sedicesimo2 (bar 1 quarters, bar 2 2nd sixteenth)", () => {
  const challenge = getChallenge("battere-poi-sedicesimo2");
  // Bar 2's 2nd sixteenth (sub-beat index 1, 125ms steps) at each quarter:
  // 2000 + q*500 + 125.
  const TARGETS_MS = [0, 500, 1000, 1500, 2125, 2625, 3125, 3625];

  test("passes when all 4 battere and all 4 2nd-sixteenth hits land on time", () => {
    const result = scoreChallenge(challenge, buildWaveform(TARGETS_MS), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarto 1", "Quarto 2", "Quarto 3", "Quarto 4",
      "Sedicesimo-2 1", "Sedicesimo-2 2", "Sedicesimo-2 3", "Sedicesimo-2 4",
    ]);
    expect(result.hits.every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("fails when the 2nd-sixteenth bar is missing entirely", () => {
    const result = scoreChallenge(
      challenge,
      buildWaveform(TARGETS_MS.slice(0, 4)),
      BPM,
      LEAD_IN_MS,
    );

    expect(result.hits.slice(0, 4).every((h) => h.onTime)).toBe(true);
    expect(result.hits.slice(4).every((h) => h.onTime)).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe("scoreChallenge — levare-poi-sedicesimo2 (bar 1 eighth's levare, bar 2 2nd sixteenth)", () => {
  const challenge = getChallenge("levare-poi-sedicesimo2");
  const TARGETS_MS = [250, 750, 1250, 1750, 2125, 2625, 3125, 3625];

  test("passes when all 4 levare and all 4 2nd-sixteenth hits land on time", () => {
    const result = scoreChallenge(challenge, buildWaveform(TARGETS_MS), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Levare 1", "Levare 2", "Levare 3", "Levare 4",
      "Sedicesimo-2 1", "Sedicesimo-2 2", "Sedicesimo-2 3", "Sedicesimo-2 4",
    ]);
    expect(result.hits.every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("bar 1 is evaluated as the eighth's levare, not battere — hitting the battere instead should not pass", () => {
    // Sound exactly on the battere (0/500/1000/1500) instead of the
    // levare — if bar 1 were mistakenly scored as "quarter" this would
    // wrongly pass bar 1.
    const battereInstead = [0, 500, 1000, 1500, 2125, 2625, 3125, 3625];
    const result = scoreChallenge(challenge, buildWaveform(battereInstead), BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 4).every((h) => h.onTime)).toBe(false);
    expect(result.passed).toBe(false);
  });
});
