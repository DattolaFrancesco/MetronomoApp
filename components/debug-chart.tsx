import {
  BEATS_PER_BAR,
  currentWindowHalfMs,
  SUBDIVISION_STEPS,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  type SessionSummary,
} from "@/components/sync-recorder";
import { clamp } from "@/lib/rhythm-detection";
import { useTranslation } from "@/lib/i18n";
import { Canvas, Path, Skia, type SkPath } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

// Dev/QA-only visualization: one Skia canvas *per bar*, stacked vertically
// instead of a single wide scrollable/zoomable timeline — trades vertical
// space (a whole 1-4 bar session, see maxBars on the setup screen) for
// never having to scroll sideways to compare beats. Each row draws the mic
// level as a jagged (straight-segment, not curve-smoothed) filled shape so
// peaks read as sharp triangles, the fixed quarter/sixteenth grid, and one
// line per accepted onset (red). Numeric labels stay plain RN Text,
// absolutely positioned over each row's canvas — Skia text needs a loaded
// font, which buys nothing over RN's own text layout for a handful of
// small numbers.

const CHART_HEIGHT = 110;
const TOP_LABEL_LANE = 22; // reserved strip above each row for quarter labels
const CHART_TOTAL_HEIGHT = CHART_HEIGHT + TOP_LABEL_LANE;
const ROW_GAP = 12;

// Sixteenth tick marks hang down from the same top edge as the quarter
// labels/ticks, but only span a fraction of the chart height — short marks
// anchored at the top so they read as finer subdivisions at a glance, not
// as competing beat markers.
const SIXTEENTH_TICK_HEIGHT_RATIO = 0.4;

const BARLINE_COLOR = "rgba(255,255,255,0.7)";
const QUARTER_TICK_COLOR = "rgba(255,255,255,0.55)";
// Decorative-only ruler for "quarter"/"eighth": a fixed 4-way reference
// grid, independent of the session's own subdivision, purely so those
// modes have *some* finer visual guide between the numbered quarters —
// neither mode actually evaluates onsets at these exact points (eighth
// evaluates only its single levare; quarter none at all).
const SIXTEENTH_TICK_COLOR = "rgba(255,255,255,0.16)";
// The off-beat sub-beats of a subdivision that draws its own real grid
// ("triplet" and "sixteenth" — see hasSubdivisionGrid below), i.e.
// everything but sub-beat 0 (the quarter/battere). Full-height like the
// quarter tick so they still read as real rhythmic positions, just
// dimmer/thinner. Deliberately more visible than SIXTEENTH_TICK_COLOR:
// unlike that fixed decorative ruler, these are real onset-capture
// positions of the session that was actually recorded.
const SUBDIVISION_SECONDARY_TICK_COLOR = "rgba(255,255,255,0.3)";
const WAVEFORM_FILL_COLOR = "rgba(255,138,128,0.55)";
// Outline traced over the same fill shape so a peak still reads clearly even
// when it's short — a lightly-tinted fill alone all but disappears for the
// quieter parts of a real waveform. Display-only, same as the boost below:
// neither touches the amplitude data itself, just how tall/visible it draws.
const WAVEFORM_STROKE_COLOR = "rgba(255,138,128,0.9)";
const WAVEFORM_STROKE_WIDTH = 1.5;

// Perceptual boost for the drawn height only — real waveform/envelope
// amplitudes are usually clustered in the lower part of the 0..1 range
// (most everyday sounds sit well under 0dBFS), which reads as a nearly
// flat line at a linear 1:1 scale. Square-rooting expands the quiet-to-
// moderate range visually — a value of 0.09, say, draws at 0.3 instead of
// vanishing — without changing the underlying number anywhere it's
// actually read for detection (this file only ever draws it).
function boostForDisplay(value: number): number {
  return Math.sqrt(clamp(value, 0, 1));
}

// Same normalization sync-recorder.tsx's own SILENCE_FLOOR_DB applies to
// the legacy metering-based waveform, reused here so an iOS mic session's
// displayEnvelope (raw linear RMS, not pre-normalized) reads on the same
// visual 0..1 scale instead of looking uniformly duller/louder than a
// summary.waveform-based row would.
const ENVELOPE_SILENCE_FLOOR_DB = -50;
function envelopeValueToNorm(value: number): number {
  const db = value > 0 ? 20 * Math.log10(value) : ENVELOPE_SILENCE_FLOOR_DB;
  return clamp((db - ENVELOPE_SILENCE_FLOOR_DB) / (0 - ENVELOPE_SILENCE_FLOOR_DB), 0, 1);
}

// One line per accepted onset, on-time or not — the chips/stat counts in
// session-report.tsx already carry the accuracy color-coding; this chart's
// job is just to show *where* each real hit landed against the grid, so
// every event gets the same accent color regardless of status. Microphone-
// mode only — a tap has no amplitude/threshold ambiguity behind it, so tap
// sessions color each line by its own status instead (see
// TAP_ONTIME_COLOR/TAP_OFFTIME_COLOR below).
const ONSET_LINE_COLOR = "#FF3B30";
// Same green already used for "on time"/success elsewhere in the app (see
// SUCCESS_COLOR in components/challenge-screen.tsx).
const TAP_ONTIME_COLOR = "#39FF6A";
const TAP_OFFTIME_COLOR = "#FF3B30";

type BarRow = {
  barNumber: number;
  waveformPath: SkPath;
  quarterTickPath: SkPath;
  sixteenthTickPath: SkPath;
  // Only populated for subdivisions with their own real grid ("triplet",
  // "sixteenth" — see hasSubdivisionGrid below): every sub-beat but 0 (the
  // quarter/battere) of each quarter, always secondary — for "triplet"
  // regardless of which off-beat note is the session's evaluated
  // TripletTarget. Stays an empty path (renders nothing) for "quarter"/
  // "eighth", so it's always safe to include in the Canvas below.
  subdivisionSecondaryTickPath: SkPath;
  barlinePath: SkPath;
  // Microphone-mode onset lines (single fixed color) — always empty for a
  // tap-mode summary, which uses tapOnTimePath/tapOffTimePath instead. Both
  // pairs are always safe to include in the Canvas below, same reasoning
  // as subdivisionSecondaryTickPath above.
  onsetPath: SkPath;
  tapOnTimePath: SkPath;
  tapOffTimePath: SkPath;
  quarterLabels: { x: number; label: string }[];
};

type DebugChartProps = {
  summary: SessionSummary;
  // Both default true (SessionReport's single-chart-per-report use). A
  // caller rendering several DebugCharts in the same report (see
  // ChallengeReport's Timing Analysis, one instance per bar/segment) sets
  // these false past the first instance/row — the legend/description
  // explain the chart itself, not any one bar, so repeating them per
  // instance is just noise once the reader's already seen it once; the
  // per-row "Bar N" label is similarly redundant once the caller already
  // supplies its own heading per instance (every instance here only ever
  // has one row anyway — maxBars is always 1 in that caller).
  showDescription?: boolean;
  showRowLabel?: boolean;
};

export default function DebugChart({
  summary,
  showDescription = true,
  showRowLabel = true,
}: DebugChartProps) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  // "triplet" and "sixteenth" both evaluate every one of their sub-beats
  // (see evaluatedSubBeats in lib/rhythm-detection.ts) and get their own
  // precise per-quarter grid below; "quarter"/"eighth" fall back to the
  // fixed decorative 4-way ruler (SIXTEENTH_TICK_COLOR) instead, since
  // most of those positions aren't actually evaluated for them.
  const hasSubdivisionGrid =
    summary.subdivision === "triplet" || summary.subdivision === "sixteenth";

  const beatIntervalMs = 60000 / summary.bpm;
  const barDurationMs = beatIntervalMs * BEATS_PER_BAR;
  const envelope = summary.displayEnvelope;
  const totalMs = Math.max(
    summary.durationMs,
    summary.waveform.length * WAVEFORM_SAMPLE_INTERVAL_MS,
    envelope ? envelope.values.length * envelope.hopMs : 0,
  );

  // One row per bar, each spanning the full measured width — the whole
  // reason there's no horizontal scroll/zoom here anymore.
  const rows = useMemo(() => {
    if (
      width <= 0 ||
      !Number.isFinite(beatIntervalMs) ||
      beatIntervalMs <= 0
    ) {
      return [] as BarRow[];
    }

    const baseline = TOP_LABEL_LANE + CHART_HEIGHT;
    // Exactly the number of bars chosen on the setup screen when known —
    // durationMs always overshoots it a bit (recording continues briefly
    // past the last beat before Stop tears everything down), which would
    // otherwise round up to a spurious, mostly-empty extra row.
    const totalBars =
      summary.maxBars ?? Math.max(1, Math.ceil(totalMs / barDurationMs));

    // How much real audio to show before the very first quarter and after
    // the very last one — same margin the recorder actually captures (see
    // leadInMs on SyncRecorder/SessionSummary) for the "before", and the
    // same tempo-adaptive window size used everywhere else for the
    // "after" (the recorder always keeps at least a full beat of tail
    // audio past the last beat before stopping, comfortably more than this).
    const leadInMs = summary.leadInMs ?? 0;
    const postRollMs = currentWindowHalfMs(beatIntervalMs);

    const result: BarRow[] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      const isFirst = bar === 0;
      const isLast = bar === totalBars - 1;
      const nominalStart = bar * barDurationMs;
      const nominalEnd = nominalStart + barDurationMs;
      // Only the first/last row's outer edge gets padded — bars in between
      // butt up against each other exactly as before.
      const barStart = isFirst ? nominalStart - leadInMs : nominalStart;
      const barEnd = isLast ? nominalEnd + postRollMs : nominalEnd;
      // Per-row scale so a padded first/last row's wider true-time span
      // still fits exactly into the same pixel width as every other row.
      const rowPxPerMs = width / (barEnd - barStart);

      // Waveform: straight segments between consecutive bucket points
      // (no curve smoothing) so every peak reads as a distinct triangle
      // instead of a rounded hill — same amplitude data as the live
      // "Input audio" view, just a filled silhouette here. Bucket time is
      // waveform-relative (index 0 = true time -leadInMs), so bar-relative
      // true time needs +leadInMs to land on the right bucket.
      //
      // An iOS mic session carries its trace in displayEnvelope instead of
      // summary.waveform (see DisplayEnvelope) — much finer (native ~5ms
      // hop vs. the legacy 50ms bucket) and built from real recorded
      // samples, not smoothed live metering. Same drawing logic either way,
      // just parameterized on which bucket size/offset/value-source to
      // read; envelope wins when present since it's always the more
      // precise trace for any session that has one.
      const waveformPath = Skia.Path.Make();
      const waveformSource = envelope
        ? {
            length: envelope.values.length,
            hopMs: envelope.hopMs,
            offsetMs: envelope.startOffsetMs,
            valueAt: (i: number) => envelopeValueToNorm(envelope.values[i]),
          }
        : {
            length: summary.waveform.length,
            hopMs: WAVEFORM_SAMPLE_INTERVAL_MS,
            offsetMs: leadInMs,
            valueAt: (i: number) => summary.waveform[i],
          };
      if (summary.inputSource !== "tap" && waveformSource.length > 0) {
        const { length, hopMs, offsetMs, valueAt } = waveformSource;
        const firstBucket = Math.max(
          0,
          Math.floor((barStart + offsetMs) / hopMs) - 1,
        );
        const lastBucket = Math.min(
          length - 1,
          Math.ceil((barEnd + offsetMs) / hopMs) + 1,
        );
        for (let b = firstBucket; b <= lastBucket; b++) {
          const trueTime = b * hopMs - offsetMs;
          const x = (trueTime - barStart) * rowPxPerMs;
          const y = baseline - Math.max(1, boostForDisplay(valueAt(b)) * CHART_HEIGHT);
          if (b === firstBucket) {
            waveformPath.moveTo(x, baseline);
            waveformPath.lineTo(x, y);
          } else {
            waveformPath.lineTo(x, y);
          }
        }
        if (lastBucket >= firstBucket) {
          const lastTrueTime = lastBucket * hopMs - offsetMs;
          const lastX = (lastTrueTime - barStart) * rowPxPerMs;
          waveformPath.lineTo(lastX, baseline);
          waveformPath.close();
        }
      }

      const quarterTickPath = Skia.Path.Make();
      const sixteenthTickPath = Skia.Path.Make();
      const subdivisionSecondaryTickPath = Skia.Path.Make();
      const barlinePath = Skia.Path.Make();
      const quarterLabels: { x: number; label: string }[] = [];

      // "triplet"/"sixteenth" get their own branch: instead of one tick per
      // quarter plus the decorative subdivision-agnostic ruler, draw every
      // real sub-beat position of every quarter. Prominence here tracks
      // rhythmic *structure*, not which sub-beat is being evaluated:
      // sub-beat 0 (the quarter's own battere — always the first point
      // generated, by construction of the `sub * subIntervalMs` formula
      // below) gets the exact same standard white tick + numbered label
      // every other subdivision already uses; for q === 0 that position is
      // also the true start of the bar, which barlinePath below
      // independently stamps with its own heavier marker, so the very
      // first line of the bar reads as the most prominent one without
      // extra styling here. Every other sub-beat always gets the
      // dimmer/thinner secondary treatment — for "triplet" that's true
      // regardless of which off-beat note is this session's evaluated
      // TripletTarget; which one actually got judged is shown by the red
      // onset line, not by grid emphasis.
      for (let q = 0; q < BEATS_PER_BAR; q++) {
        const quarterTime = nominalStart + q * beatIntervalMs;

        if (hasSubdivisionGrid) {
          const steps = SUBDIVISION_STEPS[summary.subdivision];
          const subIntervalMs = beatIntervalMs / steps;
          for (let sub = 0; sub < steps; sub++) {
            const subX =
              (quarterTime + sub * subIntervalMs - barStart) * rowPxPerMs;
            if (sub === 0) {
              quarterTickPath.moveTo(subX, TOP_LABEL_LANE);
              quarterTickPath.lineTo(subX, TOP_LABEL_LANE + CHART_HEIGHT);
              quarterLabels.push({ x: subX, label: String(q + 1) });
            } else {
              subdivisionSecondaryTickPath.moveTo(subX, TOP_LABEL_LANE);
              subdivisionSecondaryTickPath.lineTo(subX, TOP_LABEL_LANE + CHART_HEIGHT);
            }
          }
          continue;
        }

        const x = (quarterTime - barStart) * rowPxPerMs;

        quarterTickPath.moveTo(x, TOP_LABEL_LANE);
        quarterTickPath.lineTo(x, TOP_LABEL_LANE + CHART_HEIGHT);
        // Quarters are always just numbered 1-4 within the bar, regardless
        // of which subdivision was actually recorded.
        quarterLabels.push({ x, label: String(q + 1) });

        // Sixteenth reference grid — always shown as short unlabeled
        // dashes, independent of the session's own subdivision, purely as
        // a finer visual ruler between the numbered quarters.
        for (let s = 1; s < 4; s++) {
          const subX = (quarterTime + (s * beatIntervalMs) / 4 - barStart) * rowPxPerMs;
          sixteenthTickPath.moveTo(subX, TOP_LABEL_LANE);
          sixteenthTickPath.lineTo(
            subX,
            TOP_LABEL_LANE + CHART_HEIGHT * SIXTEENTH_TICK_HEIGHT_RATIO,
          );
        }
      }
      // Marks the true start of this bar — inset from the row's left edge
      // on the first row, where the extra pre-roll margin sits to its left.
      const barlineX = (nominalStart - barStart) * rowPxPerMs;
      barlinePath.moveTo(barlineX, 0);
      barlinePath.lineTo(barlineX, TOP_LABEL_LANE + CHART_HEIGHT);

      const onsetPath = Skia.Path.Make();
      const tapOnTimePath = Skia.Path.Make();
      const tapOffTimePath = Skia.Path.Make();
      for (const event of summary.events) {
        const t = event.elapsedMs + event.deltaMs;
        if (t < barStart || t >= barEnd) continue;
        const x = (t - barStart) * rowPxPerMs;
        // Tap mode: exact press timestamp, colored by its own status
        // (matching lib/rhythm-detection.ts's classifyOnset — no amplitude/
        // threshold ambiguity to search for, unlike a mic hit). Mic mode:
        // unchanged single-color line, same as before this feature existed.
        const path =
          summary.inputSource === "tap"
            ? event.status === "onTime"
              ? tapOnTimePath
              : tapOffTimePath
            : onsetPath;
        path.moveTo(x, TOP_LABEL_LANE);
        path.lineTo(x, TOP_LABEL_LANE + CHART_HEIGHT);
      }

      result.push({
        barNumber: bar + 1,
        waveformPath,
        quarterTickPath,
        sixteenthTickPath,
        subdivisionSecondaryTickPath,
        barlinePath,
        onsetPath,
        tapOnTimePath,
        tapOffTimePath,
        quarterLabels,
      });
    }
    return result;
  }, [
    width,
    beatIntervalMs,
    barDurationMs,
    totalMs,
    summary.waveform,
    envelope,
    summary.events,
    summary.maxBars,
    summary.leadInMs,
    summary.subdivision,
    summary.inputSource,
  ]);

  return (
    <View className="gap-2">
      {showDescription && (
        <>
          <Text className="text-neutral-600 text-[10px] leading-4">
            {t(
              `debugChart.description.${summary.inputSource === "tap" ? "tap" : "mic"}.${
                summary.subdivision === "triplet"
                  ? "triplet"
                  : summary.subdivision === "sixteenth"
                    ? "sixteenth"
                    : "default"
              }`,
            )}
          </Text>

          <View className="flex-row flex-wrap gap-x-3 gap-y-1">
            <LegendLine color={QUARTER_TICK_COLOR} label={t("debugChart.legend.quarter")} />
            {hasSubdivisionGrid && (
              <LegendLine
                color={SUBDIVISION_SECONDARY_TICK_COLOR}
                label={
                  summary.subdivision === "triplet"
                    ? t("debugChart.legend.tripletSubdivisions")
                    : t("debugChart.legend.innerSixteenths")
                }
              />
            )}
            {summary.inputSource === "tap" ? (
              <>
                <LegendLine color={TAP_ONTIME_COLOR} label={t("debugChart.legend.onTime")} />
                <LegendLine color={TAP_OFFTIME_COLOR} label={t("debugChart.legend.outOfTolerance")} />
              </>
            ) : (
              <LegendLine color={ONSET_LINE_COLOR} label={t("debugChart.legend.hit")} />
            )}
          </View>
        </>
      )}

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {rows.map((row) => (
          <View key={row.barNumber} style={{ marginBottom: ROW_GAP }}>
            {showRowLabel && (
              <Text className="text-white text-[10px] font-bold uppercase tracking-widest mb-1">
                {t("debugChart.barLabel", { n: row.barNumber })}
              </Text>
            )}
            <View style={{ width, height: CHART_TOTAL_HEIGHT }}>
              <Canvas style={{ width, height: CHART_TOTAL_HEIGHT }}>
                <Path path={row.waveformPath} color={WAVEFORM_FILL_COLOR} style="fill" />
                <Path
                  path={row.waveformPath}
                  color={WAVEFORM_STROKE_COLOR}
                  style="stroke"
                  strokeWidth={WAVEFORM_STROKE_WIDTH}
                />
                <Path path={row.sixteenthTickPath} color={SIXTEENTH_TICK_COLOR} style="stroke" strokeWidth={1} />
                <Path path={row.subdivisionSecondaryTickPath} color={SUBDIVISION_SECONDARY_TICK_COLOR} style="stroke" strokeWidth={1} />
                <Path path={row.quarterTickPath} color={QUARTER_TICK_COLOR} style="stroke" strokeWidth={1} />
                <Path path={row.barlinePath} color={BARLINE_COLOR} style="stroke" strokeWidth={2} />
                <Path path={row.onsetPath} color={ONSET_LINE_COLOR} style="stroke" strokeWidth={2} />
                <Path path={row.tapOnTimePath} color={TAP_ONTIME_COLOR} style="stroke" strokeWidth={2} />
                <Path path={row.tapOffTimePath} color={TAP_OFFTIME_COLOR} style="stroke" strokeWidth={2} />
              </Canvas>

              {/* Numeric labels only — the lines/waveform themselves are
                  the canvas above; this layer is just RN Text positioned
                  to match each quarter tick's x. Absolutely positioned
                  (not just its Text children) so it overlays the top of
                  the canvas instead of flowing below it. */}
              <View
                pointerEvents="none"
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
              >
                {row.quarterLabels.map((l) => (
                  <Text
                    key={l.x}
                    style={{
                      position: "absolute",
                      left: l.x + 3,
                      top: 6,
                      fontSize: 11,
                      fontWeight: "700",
                      color: "#FFFFFF",
                    }}
                  >
                    {l.label}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <View style={{ width: 10, height: 2, backgroundColor: color }} />
      <Text className="text-neutral-500 text-[9px]">{label}</Text>
    </View>
  );
}
