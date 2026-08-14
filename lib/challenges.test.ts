import {
  CHALLENGE_BARS,
  CHALLENGE_TOLERANCE_MS,
  CHALLENGES,
  scoreBattereLevareChallenge,
} from "./challenges";

// 120 BPM: beatIntervalMs = 500, barDurationMs = 2000.
// Bar 1 (quarters/battere) expected at 0/500/1000/1500ms.
// Bar 2 (eighth's levare) expected at 2250/2750/3250/3750ms (bar-2-relative
// 250/750/1250/1750, +2000ms for bar 1).
const BPM = 120;
const LEAD_IN_MS = 100; // pre-roll so the very first hit has a real trough to rise from
const TARGETS_MS = [0, 500, 1000, 1500, 2250, 2750, 3250, 3750];

function buildWaveform(hitTimesMs: number[]): number[] {
  const waveform = new Array(90).fill(0.05);
  for (const t of hitTimesMs) {
    waveform[(t + LEAD_IN_MS) / 50] = 0.9;
  }
  return waveform;
}

describe("CHALLENGES — data", () => {
  test("battere-poi-levare is defined, fixed at 2 bars and 80ms tolerance", () => {
    const challenge = CHALLENGES.find((c) => c.id === "battere-poi-levare");
    expect(challenge).toBeDefined();
    expect(CHALLENGE_BARS).toBe(2);
    expect(CHALLENGE_TOLERANCE_MS).toBe(80);
  });
});

describe("scoreBattereLevareChallenge", () => {
  test("passes when all 4 battere and all 4 levare hits land on time", () => {
    const waveform = buildWaveform(TARGETS_MS);
    const result = scoreBattereLevareChallenge(waveform, BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(8);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarto 1",
      "Quarto 2",
      "Quarto 3",
      "Quarto 4",
      "Levare 1",
      "Levare 2",
      "Levare 3",
      "Levare 4",
    ]);
    expect(result.hits.every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("fails when a single hit misses the 80ms tolerance, even though every other hit is on time", () => {
    const waveform = buildWaveform(TARGETS_MS);
    // Move the last levare 200ms late — outside the 80ms tolerance but
    // still inside the search window, so it's matched, just not on time.
    const lastTargetBucket = (3750 + LEAD_IN_MS) / 50;
    waveform[lastTargetBucket] = 0.05;
    waveform[(3750 + 200 + LEAD_IN_MS) / 50] = 0.9;

    const result = scoreBattereLevareChallenge(waveform, BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 7).every((h) => h.onTime)).toBe(true);
    expect(result.hits[7]).toEqual({ label: "Levare 4", onTime: false });
    expect(result.passed).toBe(false);
  });

  test("fails when a hit is missing entirely (silence), not just off-tolerance ones", () => {
    // Same as the passing case but the last levare never sounds at all.
    const waveform = buildWaveform(TARGETS_MS.slice(0, 7));
    const result = scoreBattereLevareChallenge(waveform, BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 7).every((h) => h.onTime)).toBe(true);
    expect(result.hits[7]).toEqual({ label: "Levare 4", onTime: false });
    expect(result.passed).toBe(false);
  });

  test("bar 1 is evaluated as quarters (battere) and bar 2 as the eighth's levare, not the other way round", () => {
    // Only the battere positions of bar 1 sound — if bar 1 were instead
    // evaluated as levare (or bar 2 as battere), this would score
    // differently than "all 4 Quarto hits on time, all 4 Levare missing".
    const waveform = buildWaveform(TARGETS_MS.slice(0, 4));
    const result = scoreBattereLevareChallenge(waveform, BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 4).every((h) => h.onTime)).toBe(true);
    expect(result.hits.slice(4).every((h) => h.onTime)).toBe(false);
  });
});
