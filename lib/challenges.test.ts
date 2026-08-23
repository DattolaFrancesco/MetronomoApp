import { SUBDIVISION_STEPS } from "./rhythm-detection";
import {
  CHALLENGES,
  challengeBars,
  scoreChallenge,
  scoreChallengeFromTaps,
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
  test("11 challenges, ordered easiest to hardest, with the expected per-tier tolerance", () => {
    expect(CHALLENGES.map((c) => c.id)).toEqual([
      "battere-poi-levare",
      "levare-poi-battere",
      "battere-levare-battere",
      "battere-poi-sedicesimo2",
      "battere-poi-terzina3",
      "sedicesimo2-battere-sedicesimo4",
      "levare-poi-sedicesimo2",
      "giro-sedicesimi",
      "doppia-alternanza-levare",
      "battere-levare-terzina3",
      "alternanza-battuta",
    ]);
    expect(CHALLENGES.map((c) => c.difficulty)).toEqual([
      "facile", "facile", "facile",
      "medio", "medio", "medio",
      "difficile", "difficile", "difficile",
      "expert", "expert",
    ]);
    expect(CHALLENGES.map((c) => c.toleranceMs)).toEqual([
      100, 100, 100, 90, 90, 90, 80, 80, 80, 70, 70,
    ]);
  });

  test("challengeBars derives the right bar count for a 2-bar, a 4-bar, and the single-bar challenge", () => {
    expect(challengeBars(getChallenge("battere-poi-levare"))).toBe(2);
    expect(challengeBars(getChallenge("giro-sedicesimi"))).toBe(4);
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

  test("a loud downbeat right after a quiet Upbeat 4 doesn't steal its hit", () => {
    // Upbeat 4 (1750ms) and Quarter 1 (2000ms) sit exactly matchRadius
    // (250ms at 120 BPM) apart — Upbeat 4's own search window reaches all
    // the way to Quarter 1's target. Before the maxSearchTimeMs cap in
    // scoreChallenge, pickPeakInRange's "loudest wins" rule meant a louder
    // Quarter 1 sitting right at that edge would win over Upbeat 4's own,
    // quieter attack and get wrongly credited as Upbeat 4's hit — exactly
    // the bug reported from real playing (an accented downbeat is common).
    const targets = allTargetsMs(challenge);
    const waveform = buildWaveform(targets);
    const quietBucket = Math.round((targets[3] + LEAD_IN_MS) / 50);
    const loudBucket = Math.round((targets[4] + LEAD_IN_MS) / 50);
    waveform[quietBucket] = 0.4; // Upbeat 4 — real but quiet
    waveform[loudBucket] = 0.9; // Quarter 1 — accented downbeat

    const result = scoreChallenge(challenge, waveform, BPM, LEAD_IN_MS);

    const upbeat4 = result.hits[3];
    expect(upbeat4.label).toBe("Upbeat 4");
    expect(upbeat4.onTime).toBe(true);
    expect(upbeat4.deltaMs).not.toBeNull();
    expect(Math.abs(upbeat4.deltaMs ?? Infinity)).toBeLessThan(50);
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

describe("scoreChallenge — battere-levare-battere (downbeat, upbeat, back to downbeat over 3 bars)", () => {
  const challenge = getChallenge("battere-levare-battere");

  test("passes when all 12 hits across the 3 bars (downbeat, upbeat, downbeat) land on time", () => {
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(12);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
      "Upbeat 1", "Upbeat 2", "Upbeat 3", "Upbeat 4",
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("fails if the third bar is played on the upbeat again instead of switching back to the downbeat", () => {
    const bar1and2 = allTargetsMs(challenge).slice(0, 8);
    const wrongBar3 = [4250, 4750, 5250, 5750]; // upbeat positions, not downbeat
    const result = scoreChallenge(challenge, buildWaveform([...bar1and2, ...wrongBar3]), BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 8).every((h) => h.onTime)).toBe(true);
    expect(result.hits.slice(8).every((h) => h.onTime)).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe("scoreChallenge — battere-poi-terzina3 (triplet-based pairing)", () => {
  test("passes when bar 2 lands on the triplet's 3rd note", () => {
    const challenge = getChallenge("battere-poi-terzina3");
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
      "Triplet-3 1", "Triplet-3 2", "Triplet-3 3", "Triplet-3 4",
    ]);
    expect(result.passed).toBe(true);
  });
});

describe("scoreChallenge — sedicesimo2-battere-sedicesimo4 (2nd sixteenth, downbeat, 4th sixteenth over 3 bars)", () => {
  const challenge = getChallenge("sedicesimo2-battere-sedicesimo4");

  test("passes when all 12 hits across the 3 bars (2nd sixteenth, downbeat, 4th sixteenth) land on time", () => {
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(12);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Sixteenth-2 1", "Sixteenth-2 2", "Sixteenth-2 3", "Sixteenth-2 4",
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
      "Sixteenth-4 1", "Sixteenth-4 2", "Sixteenth-4 3", "Sixteenth-4 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("fails if the middle bar is played on the 2nd sixteenth again instead of the downbeat", () => {
    const bar1 = allTargetsMs(challenge).slice(0, 4);
    const wrongBar2 = bar1.map((t) => t + 2000); // same 2nd-sixteenth offsets, bar 2's timing
    const bar3 = allTargetsMs(challenge).slice(8);
    const result = scoreChallenge(challenge, buildWaveform([...bar1, ...wrongBar2, ...bar3]), BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 4).every((h) => h.onTime)).toBe(true);
    expect(result.hits.slice(4, 8).every((h) => h.onTime)).toBe(false);
    expect(result.hits.slice(8).every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe("scoreChallenge — giro-sedicesimi (four bars, one per sixteenth position)", () => {
  const challenge = getChallenge("giro-sedicesimi");

  test("passes when all 16 hits across the 4 bars (downbeat, 2nd/3rd/4th sixteenth) land on time", () => {
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(16);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
      "Sixteenth-2 1", "Sixteenth-2 2", "Sixteenth-2 3", "Sixteenth-2 4",
      "Sixteenth-3 1", "Sixteenth-3 2", "Sixteenth-3 3", "Sixteenth-3 4",
      "Sixteenth-4 1", "Sixteenth-4 2", "Sixteenth-4 3", "Sixteenth-4 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("fails if the last bar (4th sixteenth) never sounds", () => {
    const targets = allTargetsMs(challenge).slice(0, 12);
    const result = scoreChallenge(challenge, buildWaveform(targets), BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 12).every((h) => h.onTime)).toBe(true);
    expect(result.hits.slice(12).every((h) => h.onTime)).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe("scoreChallenge — doppia-alternanza-levare (mixed subdivision within two of the three bars)", () => {
  const challenge = getChallenge("doppia-alternanza-levare");

  test("passes when bar 1 alternates 2nd-sixteenth/downbeat, bar 2 is all upbeat, bar 3 alternates 4th-sixteenth/upbeat", () => {
    const result = scoreChallenge(challenge, buildWaveform(allTargetsMs(challenge)), BPM, LEAD_IN_MS);

    expect(result.hits).toHaveLength(12);
    expect(result.hits.map((h) => h.label)).toEqual([
      "Sixteenth-2 1", "Quarter 2", "Sixteenth-2 3", "Quarter 4",
      "Upbeat 1", "Upbeat 2", "Upbeat 3", "Upbeat 4",
      "Sixteenth-4 1", "Upbeat 2", "Sixteenth-4 3", "Upbeat 4",
    ]);
    expect(result.passed).toBe(true);
  });

  test("fails if bar 2 is played on the downbeat instead of the upbeat", () => {
    const bar1 = allTargetsMs(challenge).slice(0, 4);
    const wrongBar2 = [2000, 2500, 3000, 3500]; // downbeat positions, not upbeat
    const bar3 = allTargetsMs(challenge).slice(8);
    const result = scoreChallenge(challenge, buildWaveform([...bar1, ...wrongBar2, ...bar3]), BPM, LEAD_IN_MS);

    expect(result.hits.slice(0, 4).every((h) => h.onTime)).toBe(true);
    expect(result.hits.slice(4, 8).every((h) => h.onTime)).toBe(false);
    expect(result.hits.slice(8).every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(false);
  });

  test("ignoring the alternation in bar 1 (playing every quarter on the downbeat) only satisfies quarters 2&4", () => {
    const allBattereBar1 = [0, 500, 1000, 1500];
    const rest = allTargetsMs(challenge).slice(4);
    const result = scoreChallenge(challenge, buildWaveform([...allBattereBar1, ...rest]), BPM, LEAD_IN_MS);

    expect(result.hits[0].onTime).toBe(false); // Sixteenth-2 1
    expect(result.hits[1].onTime).toBe(true); // Quarter 2
    expect(result.hits[2].onTime).toBe(false); // Sixteenth-2 3
    expect(result.hits[3].onTime).toBe(true); // Quarter 4
    expect(result.passed).toBe(false);
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

describe("scoreChallengeFromTaps — tap-mode scoring", () => {
  test("battere-poi-levare: taps exactly on the expected grid pass, same hit labels as the mic path", () => {
    const challenge = getChallenge("battere-poi-levare");
    const targets = allTargetsMs(challenge);

    const result = scoreChallengeFromTaps(challenge, targets, BPM);

    expect(result.hits).toHaveLength(8);
    expect(result.hits.every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(true);
    // Same label scheme scoreChallenge already produces for this challenge.
    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4",
      "Upbeat 1", "Upbeat 2", "Upbeat 3", "Upbeat 4",
    ]);
  });

  test("a missing tap fails that hit but leaves the others matched", () => {
    const challenge = getChallenge("battere-poi-levare");
    const targets = allTargetsMs(challenge);
    const missingOne = targets.filter((_, i) => i !== 2); // drop Quarter 3

    const result = scoreChallengeFromTaps(challenge, missingOne, BPM);

    expect(result.hits[2].onTime).toBe(false);
    expect(result.hits[2].deltaMs).toBeNull();
    expect(result.hits.filter((h) => h.onTime)).toHaveLength(7);
    expect(result.passed).toBe(false);
  });

  test("a tap outside the tolerance (but still inside matchRadius) fails that hit", () => {
    const challenge = getChallenge("battere-poi-levare"); // toleranceMs 100
    const targets = allTargetsMs(challenge);
    const shifted = targets.map((t, i) => (i === 0 ? t + 150 : t));

    const result = scoreChallengeFromTaps(challenge, shifted, BPM);

    expect(result.hits[0].onTime).toBe(false);
    expect(result.hits[0].deltaMs).toBeCloseTo(150, 0);
    expect(result.passed).toBe(false);
  });

  test("alternanza-battuta (mixed subdivision within one bar) works for taps exactly like scoreChallenge", () => {
    const challenge = getChallenge("alternanza-battuta");
    const targets = allTargetsMs(challenge);
    expect(targets).toEqual([0, 625, 1000, 1625]);

    const result = scoreChallengeFromTaps(challenge, targets, BPM);

    expect(result.hits.map((h) => h.label)).toEqual([
      "Quarter 1", "Sixteenth-2 2", "Quarter 3", "Sixteenth-2 4",
    ]);
    expect(result.hits.every((h) => h.onTime)).toBe(true);
    expect(result.passed).toBe(true);
  });

  test("debugGroups: one per bar, tap-tagged, bar-relative elapsedMs, and no waveform", () => {
    const challenge = getChallenge("levare-poi-battere"); // 2 bars
    const targets = allTargetsMs(challenge);

    const result = scoreChallengeFromTaps(challenge, targets, BPM);

    expect(result.debugGroups).toHaveLength(challengeBars(challenge));
    result.debugGroups.forEach((group) => {
      expect(group.summary.inputSource).toBe("tap");
      expect(group.summary.waveform).toEqual([]);
      expect(group.summary.tapTimesMs).toEqual(targets);
      // Every event in this bar's summary must fall inside this bar's own
      // local [0, barDurationMs) range — proves elapsedMs was rebased per
      // bar instead of staying absolute across the whole challenge.
      const barDurationMs = (60000 / BPM) * 4;
      for (const event of group.summary.events) {
        expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(event.elapsedMs).toBeLessThan(barDurationMs);
      }
    });
    // Bar 2's own hits should still all be onTime even though their
    // absolute time is well past bar 1's range.
    const bar2Events = result.debugGroups[1].summary.events;
    expect(bar2Events.length).toBeGreaterThan(0);
    expect(bar2Events.every((e) => e.status === "onTime")).toBe(true);
  });
});
