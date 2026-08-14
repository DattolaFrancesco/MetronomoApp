import {
  analyzeSession,
  classifyOnset,
  computeClickGateEnd,
  computeExpectedHits,
  computeSubBeatTimestamps,
  evaluatedSubBeats,
  findOnsetPeaks,
  isWithinClickGate,
  MIN_PEAK_AMPLITUDE,
  pickPeakInRange,
  primarySubBeat,
  SUBDIVISION_STEPS,
} from "./rhythm-detection";

describe("computeExpectedHits — expected timestamps per subdivision", () => {
  const BPM = 120; // beatIntervalMs = 500

  test("quarter: one hit per beat, every 500ms", () => {
    const hits = computeExpectedHits(BPM, "quarter", 2, 2, 4);
    expect(hits.map((h) => h.time)).toEqual([0, 500, 1000, 1500]);
    expect(hits.every((h) => h.subBeatIndex === 0)).toBe(true);
    expect(hits.map((h) => h.beatIndex)).toEqual([0, 1, 2, 3]);
  });

  test("eighth: only the levare, at 250ms/750ms/1250ms/1750ms", () => {
    const hits = computeExpectedHits(BPM, "eighth", 2, 2, 4);
    expect(hits.map((h) => h.time)).toEqual([250, 750, 1250, 1750]);
    expect(hits.every((h) => h.subBeatIndex === 1)).toBe(true);
  });

  test("triplet: only the chosen note (2nd or 3rd), one per beat", () => {
    const second = computeExpectedHits(BPM, "triplet", 2, 2, 2);
    expect(second.map((h) => h.subBeatIndex)).toEqual([1, 1]);
    expect(second[0].time).toBeCloseTo(500 / 3, 5);

    const third = computeExpectedHits(BPM, "triplet", 3, 2, 2);
    expect(third.map((h) => h.subBeatIndex)).toEqual([2, 2]);
    expect(third[0].time).toBeCloseTo((500 * 2) / 3, 5);
  });

  test("sixteenth: only the chosen note (2nd, 3rd, or 4th), one per beat", () => {
    const second = computeExpectedHits(BPM, "sixteenth", 2, 2, 2);
    expect(second.map((h) => h.subBeatIndex)).toEqual([1, 1]);
    expect(second[0].time).toBe(125);

    const third = computeExpectedHits(BPM, "sixteenth", 2, 3, 2);
    expect(third.map((h) => h.subBeatIndex)).toEqual([2, 2]);
    expect(third[0].time).toBe(250);

    const fourth = computeExpectedHits(BPM, "sixteenth", 2, 4, 2);
    expect(fourth.map((h) => h.subBeatIndex)).toEqual([3, 3]);
    expect(fourth[0].time).toBe(375);
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

  // Regression guard for the debug-chart.tsx triplet grid: it inlines this
  // same "quarterTime + sub * subIntervalMs" formula per quarter, and its
  // most prominent tick (the bar/quarter downbeat) is always drawn at
  // sub-beat index 0. That's only correct if index 0 is guaranteed to be
  // the quarter's own timestamp, unshifted — verified here at a non-zero
  // beatTime too, since an off-by-one in the point order could easily pass
  // at beatTime 0 by coincidence but not elsewhere.
  test("triplet: sub-beat index 0 always coincides exactly with the quarter's own timestamp", () => {
    const beatTime = 2000;
    const points = computeSubBeatTimestamps(beatTime, BPM, "triplet");
    expect(points[0]).toBe(beatTime);
  });

  test("sixteenth: 4 equidistant points 125ms apart", () => {
    const points = computeSubBeatTimestamps(0, BPM, "sixteenth");
    expect(points).toEqual([0, 125, 250, 375]);
  });

  // Same regression guard as the triplet one above, for "sixteenth" —
  // debug-chart.tsx's subdivision grid branch covers both.
  test("sixteenth: sub-beat index 0 always coincides exactly with the quarter's own timestamp", () => {
    const beatTime = 2000;
    const points = computeSubBeatTimestamps(beatTime, BPM, "sixteenth");
    expect(points[0]).toBe(beatTime);
  });

  test("eighth: 2 equidistant points 250ms apart", () => {
    const points = computeSubBeatTimestamps(0, BPM, "eighth");
    expect(points).toEqual([0, 250]);
  });
});

describe("primarySubBeat / evaluatedSubBeats — live BeatDot prominence (beat-indicator.tsx, the recording screen). NOT used by debug-chart.tsx's report grid: that grid's prominent tick is always the quarter/battere (sub-beat 0) regardless of TripletTarget/SixteenthTarget, so it stays a stable structural reference across the whole bar.", () => {
  test("triplet target 2: the 2nd note is primary, battere (0) and 3rd note (2) are secondary", () => {
    expect(primarySubBeat("triplet", 2, 2)).toBe(1);
    expect(evaluatedSubBeats("triplet", 2, 2)).toEqual([1]);

    const secondary = Array.from(
      { length: SUBDIVISION_STEPS.triplet },
      (_, sub) => sub,
    ).filter((sub) => sub !== primarySubBeat("triplet", 2, 2));
    expect(secondary).toEqual([0, 2]);
  });

  test("triplet target 3: the 3rd note is primary, battere (0) and 2nd note (1) are secondary", () => {
    expect(primarySubBeat("triplet", 3, 2)).toBe(2);
    expect(evaluatedSubBeats("triplet", 3, 2)).toEqual([2]);

    const secondary = Array.from(
      { length: SUBDIVISION_STEPS.triplet },
      (_, sub) => sub,
    ).filter((sub) => sub !== primarySubBeat("triplet", 3, 2));
    expect(secondary).toEqual([0, 1]);
  });

  test("triplet: the battere (sub-beat 0) is never primary — it's not a selectable TripletTarget", () => {
    expect(primarySubBeat("triplet", 2, 2)).not.toBe(0);
    expect(primarySubBeat("triplet", 3, 2)).not.toBe(0);
  });

  test("sixteenth target 2/3/4: that note is primary and the only one evaluated — the other 3 sub-beats (including the battere) are neither", () => {
    for (const target of [2, 3, 4] as const) {
      expect(primarySubBeat("sixteenth", 2, target)).toBe(target - 1);
      expect(evaluatedSubBeats("sixteenth", 2, target)).toEqual([target - 1]);

      const others = Array.from(
        { length: SUBDIVISION_STEPS.sixteenth },
        (_, sub) => sub,
      ).filter((sub) => sub !== target - 1);
      expect(others).toHaveLength(3);
      expect(evaluatedSubBeats("sixteenth", 2, target)).not.toEqual(
        expect.arrayContaining(others),
      );
    }
  });

  test("sixteenth: the battere (sub-beat 0) is never primary — it's not a selectable SixteenthTarget", () => {
    expect(primarySubBeat("sixteenth", 2, 2)).not.toBe(0);
    expect(primarySubBeat("sixteenth", 2, 3)).not.toBe(0);
    expect(primarySubBeat("sixteenth", 2, 4)).not.toBe(0);
  });

  test("SUBDIVISION_STEPS.triplet is 3, SUBDIVISION_STEPS.sixteenth is 4 — the grid always has that many tick positions per quarter", () => {
    expect(SUBDIVISION_STEPS.triplet).toBe(3);
    expect(SUBDIVISION_STEPS.sixteenth).toBe(4);
  });

  test("quarter/eighth: primarySubBeat unaffected (not in scope for the triplet/sixteenth target fix)", () => {
    expect(primarySubBeat("quarter", 2, 2)).toBe(0);
    expect(primarySubBeat("eighth", 2, 2)).toBe(1);
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

  // A loud first hit decays gradually; partway down there's a small shelf
  // (index 6, amp 0.5) before a slightly louder, later attack (index 7,
  // amp 0.55). findOnsetPeaks no longer requires a bucket to be a local
  // maximum (see MIN_ONSET_RISE / the local-max removal), only that it rose
  // enough from its own preceding trough — so the shelf at index 6
  // independently clears minOnsetRise (rise 0.10 from the trough at index 5)
  // and gets flagged *first*, resetting the trough to 0.5 right there. The
  // later, louder attack at index 7 then only has a 0.05 rise left to work
  // with from that new trough, short of the threshold, so it never gets
  // flagged itself. This is the accepted trade-off of dropping the
  // local-max requirement: it catches genuine small peaks that are quieter
  // than a neighboring bucket (the original goal), at the cost of also
  // catching an intermediate shelf inside a still-decaying tail ahead of
  // the real, later attack that follows it.
  test("decaying-tail case: an intermediate shelf can be flagged ahead of the later, louder attack", () => {
    const waveform = [0.9, 0.75, 0.62, 0.5, 0.42, 0.4, 0.5, 0.55, 0.5, 0.44, 0.38, 0.3];
    const peaks = findOnsetPeaks(waveform);

    expect(peaks[6]).toBe(true);
    expect(peaks[7]).toBe(false);
    expect(peaks.filter(Boolean)).toHaveLength(1);

    const picked = pickPeakInRange(waveform, peaks, 0, waveform.length - 1);
    expect(picked).toBe(6);
    expect(waveform[picked!]).toBe(0.5);
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

describe("classifyOnset — early/on-time/late classification", () => {
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

describe("analyzeSession — end-to-end behavior around a decaying tail", () => {
  test("a shelf partway down a decaying tail can be reported instead of the later, louder attack", () => {
    // 120 BPM: beatIntervalMs = 500, quarter search window = ±250ms.
    // Beat 0 (t=0ms) is a very loud hit that decays through beat 1's whole
    // search window [250ms, 750ms]. Its tail bottoms out at bucket 9
    // (t=450ms, amp 0.4) then ticks up to a shelf at bucket 10 (t=500ms,
    // amp 0.5, rise 0.10 — clears MIN_ONSET_RISE on its own, no longer
    // needing to be a local maximum) before beat 1's real, slightly louder
    // attack at bucket 11 (t=550ms, amp 0.58). Since the shelf at bucket 10
    // gets flagged first, the trough resets there, leaving only a 0.08 rise
    // for bucket 11 — just short of the threshold once floating-point
    // rounding is accounted for (0.58 - 0.5 computes to
    // 0.07999999999999996) — so bucket 10 is what gets reported, not the
    // louder bucket 11 right after it. Documents the known trade-off from
    // dropping the local-max requirement (see findOnsetPeaks' decaying-tail
    // test) at the analyzeSession level, so a regression that changes this
    // balance shows up here too.
    const waveform = [
      0.05, 0.95, 0.85, 0.75, 0.65, // 0-200ms: beat 0's attack + decay
      0.6, 0.55, 0.5, 0.46, 0.4, // 250-450ms: tail keeps decaying, bottoms out at 450ms
      0.5, 0.58, 0.46, 0.38, 0.28, // 500-700ms: shelf at 500ms, real attack peaks at 550ms
      0.18, 0.1, 0.05, // 750-850ms: decays back to silence
    ];

    const { events } = analyzeSession(waveform, 850, 120, "quarter", 2, 2, 90, 1);
    const beat1Event = events.find((e) => e.beatIndex === 1);

    expect(beat1Event).toBeDefined();
    // 500ms (bucket 10) - 500ms target = 0ms, not the +50ms a check that
    // still required a local maximum would have reported by holding out
    // for bucket 11.
    expect(beat1Event!.deltaMs).toBeCloseTo(0, 0);
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

describe("analyzeSession — sixteenth-note single-target filtering (same end-to-end guarantee already validated for triplet)", () => {
  test("sixteenthTarget 4: only the 4th sixteenth of each quarter is searched, evaluated, and reported — no residue on the other 3 positions", () => {
    // 120 BPM: beatIntervalMs = 500, sub-beat interval = 125ms. Target 4 →
    // sub-beat index 3, expected at quarter_time + 3*125ms (375/875/1375/1875ms).
    // maxBars=1 → totalQuarters=4, so hitDiagnostics would have 16 entries
    // (4 quarters * 4 sub-beats) if "sixteenth" still evaluated every
    // sub-beat like before this fix — it must have exactly 4 instead, all
    // at subBeatIndex 3, matching the single-target behavior already
    // proven for "triplet" above.
    const waveform = new Array(45).fill(0.05);
    // The only real sound in the whole session: a single clean hit at
    // bucket 7 (t=350ms), close to beat 0's expected 375ms (early by 25ms,
    // well inside the default 90ms tolerance).
    waveform[7] = 0.9;

    const { events, hitDiagnostics } = analyzeSession(
      waveform,
      2200,
      120,
      "sixteenth",
      2, // tripletTarget — irrelevant here
      4, // sixteenthTarget: evaluate the 4th sixteenth (sub-beat index 3)
      90,
      1, // maxBars
    );

    expect(hitDiagnostics).toHaveLength(4);
    expect(hitDiagnostics.every((h) => h.subBeatIndex === 3)).toBe(true);

    expect(events).toHaveLength(1);
    expect(events[0].beatIndex).toBe(0);
    expect(events[0].subBeatIndex).toBe(3);
    expect(events[0].status).toBe("onTime");
  });

  test("sixteenthTarget 2: the same physical hit is now evaluated against the 2nd sixteenth instead — same sound, different verdict", () => {
    // Same waveform/hit as above (bucket 7, t=350ms). With target 2
    // (sub-beat index 1), beat 0's expected time is 125ms instead of
    // 375ms — the hit still falls inside that window (matchRadius is half
    // the beat interval, 250ms, so [-125, 375]) and still gets matched,
    // but now 225ms late relative to this different expected timestamp,
    // well outside the 90ms tolerance. Proves the evaluated position
    // actually moved with the target, not just its label.
    const waveform = new Array(45).fill(0.05);
    waveform[7] = 0.9;

    const { events, hitDiagnostics } = analyzeSession(
      waveform,
      2200,
      120,
      "sixteenth",
      2,
      2, // sixteenthTarget: evaluate the 2nd sixteenth (sub-beat index 1)
      90,
      1,
    );

    expect(hitDiagnostics.every((h) => h.subBeatIndex === 1)).toBe(true);

    expect(events).toHaveLength(1);
    expect(events[0].beatIndex).toBe(0);
    expect(events[0].subBeatIndex).toBe(1);
    expect(events[0].deltaMs).toBeCloseTo(225, 0);
    expect(events[0].status).toBe("late");
  });
});
