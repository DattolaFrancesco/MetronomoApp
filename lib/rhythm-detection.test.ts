import {
  analyzeSession,
  classifyOnset,
  computeClickGateEnd,
  computeExpectedHits,
  computeSubBeatTimestamps,
  findOnsetPeaks,
  isWithinClickGate,
  MIN_PEAK_AMPLITUDE,
  pickPeakInRange,
} from "./rhythm-detection";

describe("computeExpectedHits — expected timestamps per subdivision", () => {
  const BPM = 120; // beatIntervalMs = 500

  test("quarter: one hit per beat, every 500ms", () => {
    const hits = computeExpectedHits(BPM, "quarter", 2, 4);
    expect(hits.map((h) => h.time)).toEqual([0, 500, 1000, 1500]);
    expect(hits.every((h) => h.subBeatIndex === 0)).toBe(true);
    expect(hits.map((h) => h.beatIndex)).toEqual([0, 1, 2, 3]);
  });

  test("eighth: only the levare, at 250ms/750ms/1250ms/1750ms", () => {
    const hits = computeExpectedHits(BPM, "eighth", 2, 4);
    expect(hits.map((h) => h.time)).toEqual([250, 750, 1250, 1750]);
    expect(hits.every((h) => h.subBeatIndex === 1)).toBe(true);
  });

  test("triplet: only the chosen note (2nd or 3rd), one per beat", () => {
    const second = computeExpectedHits(BPM, "triplet", 2, 2);
    expect(second.map((h) => h.subBeatIndex)).toEqual([1, 1]);
    expect(second[0].time).toBeCloseTo(500 / 3, 5);

    const third = computeExpectedHits(BPM, "triplet", 3, 2);
    expect(third.map((h) => h.subBeatIndex)).toEqual([2, 2]);
    expect(third[0].time).toBeCloseTo((500 * 2) / 3, 5);
  });

  test("sixteenth: all 4 sub-beats evaluated per beat", () => {
    const hits = computeExpectedHits(BPM, "sixteenth", 2, 1);
    expect(hits.map((h) => h.subBeatIndex)).toEqual([0, 1, 2, 3]);
    expect(hits.map((h) => h.time)).toEqual([0, 125, 250, 375]);
  });
});

describe("computeSubBeatTimestamps — equidistant sub-beat grid", () => {
  const BPM = 120; // beatIntervalMs = 500

  test("triplet: 3 equidistant points ~166.67ms apart", () => {
    const points = computeSubBeatTimestamps(0, BPM, "triplet");
    expect(points).toHaveLength(3);
    expect(points[0]).toBe(0);
    expect(points[1]).toBeCloseTo(166.667, 2);
    expect(points[2]).toBeCloseTo(333.333, 2);
    expect(points[1] - points[0]).toBeCloseTo(points[2] - points[1], 5);
  });

  test("sixteenth: 4 equidistant points 125ms apart", () => {
    const points = computeSubBeatTimestamps(0, BPM, "sixteenth");
    expect(points).toEqual([0, 125, 250, 375]);
  });

  test("eighth: 2 equidistant points 250ms apart", () => {
    const points = computeSubBeatTimestamps(0, BPM, "eighth");
    expect(points).toEqual([0, 250]);
  });
});

describe("findOnsetPeaks — onset selection", () => {
  test("normal case: a single clean peak is selected", () => {
    const waveform = [0.05, 0.1, 0.85, 0.4, 0.1];
    const peaks = findOnsetPeaks(waveform);
    expect(peaks).toEqual([false, false, true, false, false]);
  });

  test("no attack at all: flat/quiet signal has no onset peaks", () => {
    const waveform = [0.05, 0.06, 0.05, 0.07, 0.06, 0.05];
    const peaks = findOnsetPeaks(waveform);
    expect(peaks.some(Boolean)).toBe(false);
  });

  // The regression test for the bug this criterion was introduced to fix:
  // a loud first hit decays gradually, and only *later* does a real (softer)
  // new attack happen — a small local rise well after the decay's start.
  // The absolute loudest sample in this whole array is index 0 (0.9, the
  // first hit's own onset) — picking "the highest amplitude sample" would
  // wrongly report *that* as the onset for anything searching this array.
  // The real new attack is the local peak at index 7 (0.55), reached by a
  // genuine rise from the trough at index 5 (0.40). This test fails if the
  // trough-to-peak rise check is removed or broken.
  test("decaying-tail case: picks the later local rise, not the loudest sample", () => {
    const waveform = [0.9, 0.75, 0.62, 0.5, 0.42, 0.4, 0.5, 0.55, 0.5, 0.44, 0.38, 0.3];
    const peaks = findOnsetPeaks(waveform);

    expect(peaks[7]).toBe(true);
    // Nothing else in the whole array should be flagged — in particular not
    // index 0, which is the loudest sample overall but not a detectable
    // rise (it's the very first sample, nothing precedes it to rise from).
    expect(peaks.filter(Boolean)).toHaveLength(1);

    const picked = pickPeakInRange(waveform, peaks, 0, waveform.length - 1);
    expect(picked).toBe(7);
    expect(waveform[picked!]).toBe(0.55);
    expect(waveform[picked!]).toBeLessThan(waveform[0]); // confirms it's not "the loudest sample"
  });
});

describe("pickPeakInRange — minimum volume threshold", () => {
  test("a peak below MIN_PEAK_AMPLITUDE is rejected", () => {
    // Rises enough to pass the onset/rise criterion (0.20 >= MIN_ONSET_RISE)
    // but never gets loud enough to clear MIN_PEAK_AMPLITUDE (0.3).
    const waveform = [0.05, 0.1, 0.25, 0.15, 0.05];
    const peaks = findOnsetPeaks(waveform);
    expect(peaks[2]).toBe(true); // it is a genuine rise...

    const picked = pickPeakInRange(waveform, peaks, 0, waveform.length - 1);
    expect(picked).toBeNull(); // ...but too quiet to count as a real onset
  });

  test("a peak right at MIN_PEAK_AMPLITUDE is accepted", () => {
    const waveform = [0.02, 0.05, MIN_PEAK_AMPLITUDE, 0.1, 0.02];
    const peaks = findOnsetPeaks(waveform);
    const picked = pickPeakInRange(waveform, peaks, 0, waveform.length - 1);
    expect(picked).toBe(2);
  });

  test("excluded (already-claimed) buckets are skipped", () => {
    const waveform = [0.05, 0.9, 0.1, 0.05, 0.85, 0.05];
    const peaks = findOnsetPeaks(waveform);
    const picked = pickPeakInRange(
      waveform,
      peaks,
      0,
      waveform.length - 1,
      MIN_PEAK_AMPLITUDE,
      new Set([1]),
    );
    expect(picked).toBe(4);
  });
});

describe("classifyOnset — anticipo/a tempo/ritardo classification", () => {
  const TOLERANCE_MS = 90;

  test("exactly at the tolerance boundary counts as onTime", () => {
    expect(classifyOnset(TOLERANCE_MS, TOLERANCE_MS)).toBe("onTime");
    expect(classifyOnset(-TOLERANCE_MS, TOLERANCE_MS)).toBe("onTime");
  });

  test("just outside the tolerance boundary is early/late", () => {
    expect(classifyOnset(TOLERANCE_MS + 1, TOLERANCE_MS)).toBe("late");
    expect(classifyOnset(-(TOLERANCE_MS + 1), TOLERANCE_MS)).toBe("early");
  });

  test("dead on time", () => {
    expect(classifyOnset(0, TOLERANCE_MS)).toBe("onTime");
  });
});

describe("isWithinClickGate — click exclusion window", () => {
  test("a sample inside the gate is dropped", () => {
    const clickTime = 1000;
    const gateEnd = computeClickGateEnd(clickTime, 18);
    expect(isWithinClickGate(clickTime + 10, gateEnd)).toBe(true);
    expect(isWithinClickGate(gateEnd, gateEnd)).toBe(true); // boundary itself still gated
  });

  test("a sample right after the gate closes is accepted", () => {
    const clickTime = 1000;
    const gateEnd = computeClickGateEnd(clickTime, 18);
    expect(isWithinClickGate(gateEnd + 1, gateEnd)).toBe(false);
  });
});

describe("analyzeSession — end-to-end regression for the decay-tail bug", () => {
  test("a soft real hit after a loud decaying tail is reported near its true (later) time, not the tail", () => {
    // 120 BPM: beatIntervalMs = 500, quarter search window = ±250ms.
    // Beat 0 (t=0ms) is a very loud hit that decays through beat 1's whole
    // search window [250ms, 750ms] — its tail, still around 0.55-0.60, is
    // *louder* than beat 1's own real (softer) attack. Beat 1's real hit
    // rises to its peak (0.58) at t=550ms (bucket 11).
    const waveform = [
      0.05, 0.95, 0.85, 0.75, 0.65, // 0-200ms: beat 0's attack + decay
      0.6, 0.55, 0.5, 0.46, 0.4, // 250-450ms: tail keeps decaying, bottoms out at 450ms
      0.5, 0.58, 0.46, 0.38, 0.28, // 500-700ms: beat 1's real, softer attack peaks at 550ms
      0.18, 0.1, 0.05, // 750-850ms: decays back to silence
    ];

    const { events } = analyzeSession(waveform, 850, 120, "quarter", 2, 90, 1);
    const beat1Event = events.find((e) => e.beatIndex === 1);

    expect(beat1Event).toBeDefined();
    // 550ms (bucket 11) - 500ms target = +50ms, not the ~-250ms a
    // "loudest sample in the window" search would have reported by
    // grabbing beat 0's tail at bucket 5 (250ms).
    expect(beat1Event!.deltaMs).toBeCloseTo(50, 0);
    expect(beat1Event!.status).toBe("onTime");
  });

  test("leadInMs: a hit played slightly before the first beat is still captured, as a negative delta", () => {
    // leadInMs=100 means bucket index 0 is true time -100ms, so bucket i is
    // true time (i*50 - 100). A hit peaking at bucket 1 (true time -50ms) —
    // i.e. played 50ms *before* the nominal first beat — should still be
    // found and reported relative to the true first beat (elapsedMs 0),
    // not silently missed just because it happened "early".
    const waveform = [0.05, 0.8, 0.3, 0.1, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
    const { events } = analyzeSession(
      waveform,
      400,
      120,
      "quarter",
      2,
      90,
      1,
      100, // leadInMs
    );
    const beat0Event = events.find((e) => e.beatIndex === 0);

    expect(beat0Event).toBeDefined();
    expect(beat0Event!.elapsedMs).toBe(0); // still relative to the true first beat
    expect(beat0Event!.deltaMs).toBeCloseTo(-50, 0);
    expect(beat0Event!.status).toBe("onTime");
  });
});
