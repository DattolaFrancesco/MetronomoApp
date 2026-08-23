// Builds a plausible-looking, entirely fictional SessionSummary — used
// only by the main spotlight tour (see app/index.tsx) to populate the real
// SessionReport component for its report-related steps, since a genuine
// report only exists after the user has actually recorded a real session.
// Reuses the same pure analyzeSession the real app runs sessions through
// (not hand-built events/hitDiagnostics), so the fake waveform and the fake
// events it produces are internally consistent with each other exactly the
// way a real session's are — same guarantee lib/challenges.test.ts's own
// buildWaveform fixtures rely on.
import {
  analyzeSession,
  BEATS_PER_BAR,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  type SessionSummary,
} from "@/lib/rhythm-detection";

const FAKE_BPM = 90;
const FAKE_TOLERANCE_MS = 90;
const FAKE_MAX_BARS = 1;
const FAKE_LEAD_IN_MS = 100;

export function buildTourPreviewReport(): SessionSummary {
  const beatIntervalMs = 60000 / FAKE_BPM;
  const durationMs = beatIntervalMs * BEATS_PER_BAR;

  // One quarter each: on time, clearly late, on time, clearly early — see
  // the module comment above for why these need to land outside
  // FAKE_TOLERANCE_MS to actually show as early/late rather than onTime.
  const hitTimesMs = [
    0 + 5,
    beatIntervalMs + 120,
    beatIntervalMs * 2 - 8,
    beatIntervalMs * 3 - 110,
  ];

  const totalBuckets =
    Math.ceil((durationMs + beatIntervalMs / 2 + FAKE_LEAD_IN_MS) / WAVEFORM_SAMPLE_INTERVAL_MS) +
    2;
  const waveform = new Array(totalBuckets).fill(0.05);
  for (const t of hitTimesMs) {
    const bucket = Math.round((t + FAKE_LEAD_IN_MS) / WAVEFORM_SAMPLE_INTERVAL_MS);
    if (bucket >= 0 && bucket < waveform.length) waveform[bucket] = 0.9;
  }

  const { events, rejectedPeaks, hitDiagnostics } = analyzeSession(
    waveform,
    durationMs,
    FAKE_BPM,
    "quarter",
    2,
    2,
    FAKE_TOLERANCE_MS,
    FAKE_MAX_BARS,
    FAKE_LEAD_IN_MS,
  );

  return {
    events,
    rejectedPeaks,
    hitDiagnostics,
    durationMs,
    toleranceMs: FAKE_TOLERANCE_MS,
    bpm: FAKE_BPM,
    subdivision: "quarter",
    tripletTarget: 2,
    sixteenthTarget: 2,
    waveform,
    maxBars: FAKE_MAX_BARS,
    leadInMs: FAKE_LEAD_IN_MS,
  };
}
