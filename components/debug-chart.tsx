import {
  BEATS_PER_BAR,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  type OnsetStatus,
  type SessionSummary,
} from "@/components/sync-recorder";
import { Canvas, Path, Skia, type SkPath } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";

// Dev/QA-only visualization: one Skia canvas *per bar*, stacked vertically
// instead of a single wide scrollable/zoomable timeline — trades vertical
// space (a whole 1-4 bar session, see maxBars on the setup screen) for
// never having to scroll sideways to compare beats. Each row draws the mic
// level as a jagged (straight-segment, not curve-smoothed) filled shape so
// peaks read as sharp triangles, the fixed quarter/sixteenth grid, and one
// line per accepted onset (green). Numeric labels stay plain RN Text,
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
const SIXTEENTH_TICK_COLOR = "rgba(255,255,255,0.16)";
const WAVEFORM_FILL_COLOR = "rgba(57,255,106,0.35)";

// Onset line color follows the same on-time/early/late classification
// already computed in sync-recorder.tsx (OnsetEvent.status, against
// toleranceMs) — early and late are both just "not on time" here, one red,
// no need to tell them apart by color in this view.
const ONSET_STATUS_COLOR: Record<OnsetStatus, string> = {
  onTime: "#39FF6A",
  early: "#FF453A",
  late: "#FF453A",
};

type BarRow = {
  barNumber: number;
  waveformPath: SkPath;
  quarterTickPath: SkPath;
  sixteenthTickPath: SkPath;
  barlinePath: SkPath;
  onsetPath: SkPath;
  quarterLabels: { x: number; label: string }[];
};

type DebugChartProps = {
  summary: SessionSummary;
};

export default function DebugChart({ summary }: DebugChartProps) {
  const [width, setWidth] = useState(0);

  const beatIntervalMs = 60000 / summary.bpm;
  const barDurationMs = beatIntervalMs * BEATS_PER_BAR;
  const totalMs = Math.max(
    summary.durationMs,
    summary.waveform.length * WAVEFORM_SAMPLE_INTERVAL_MS,
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

    const pxPerMs = width / barDurationMs;
    const baseline = TOP_LABEL_LANE + CHART_HEIGHT;
    // Exactly the number of bars chosen on the setup screen when known —
    // durationMs always overshoots it a bit (recording continues briefly
    // past the last beat before Stop tears everything down), which would
    // otherwise round up to a spurious, mostly-empty extra row.
    const totalBars =
      summary.maxBars ?? Math.max(1, Math.ceil(totalMs / barDurationMs));

    const result: BarRow[] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      const barStart = bar * barDurationMs;
      const barEnd = barStart + barDurationMs;

      // Waveform: straight segments between consecutive bucket points
      // (no curve smoothing) so every peak reads as a distinct triangle
      // instead of a rounded hill — same amplitude data as the live
      // "Input audio" view, just a filled silhouette here.
      const waveformPath = Skia.Path.Make();
      if (summary.waveform.length > 0) {
        const firstBucket = Math.max(
          0,
          Math.floor(barStart / WAVEFORM_SAMPLE_INTERVAL_MS) - 1,
        );
        const lastBucket = Math.min(
          summary.waveform.length - 1,
          Math.ceil(barEnd / WAVEFORM_SAMPLE_INTERVAL_MS) + 1,
        );
        for (let b = firstBucket; b <= lastBucket; b++) {
          const x = (b * WAVEFORM_SAMPLE_INTERVAL_MS - barStart) * pxPerMs;
          const y = baseline - Math.max(1, summary.waveform[b] * CHART_HEIGHT);
          if (b === firstBucket) {
            waveformPath.moveTo(x, baseline);
            waveformPath.lineTo(x, y);
          } else {
            waveformPath.lineTo(x, y);
          }
        }
        if (lastBucket >= firstBucket) {
          const lastX = (lastBucket * WAVEFORM_SAMPLE_INTERVAL_MS - barStart) * pxPerMs;
          waveformPath.lineTo(lastX, baseline);
          waveformPath.close();
        }
      }

      const quarterTickPath = Skia.Path.Make();
      const sixteenthTickPath = Skia.Path.Make();
      const barlinePath = Skia.Path.Make();
      const quarterLabels: { x: number; label: string }[] = [];

      for (let q = 0; q < BEATS_PER_BAR; q++) {
        const quarterTime = q * beatIntervalMs;
        const x = quarterTime * pxPerMs;

        quarterTickPath.moveTo(x, TOP_LABEL_LANE);
        quarterTickPath.lineTo(x, TOP_LABEL_LANE + CHART_HEIGHT);
        // Quarters are always just numbered 1-4 within the bar, regardless
        // of which subdivision was actually recorded.
        quarterLabels.push({ x, label: String(q + 1) });

        // Sixteenth reference grid — always shown as short unlabeled
        // dashes, independent of the session's own subdivision, purely as
        // a finer visual ruler between the numbered quarters.
        for (let s = 1; s < 4; s++) {
          const subX = (quarterTime + (s * beatIntervalMs) / 4) * pxPerMs;
          sixteenthTickPath.moveTo(subX, TOP_LABEL_LANE);
          sixteenthTickPath.lineTo(
            subX,
            TOP_LABEL_LANE + CHART_HEIGHT * SIXTEENTH_TICK_HEIGHT_RATIO,
          );
        }
      }
      barlinePath.moveTo(0, 0);
      barlinePath.lineTo(0, TOP_LABEL_LANE + CHART_HEIGHT);

      const onsetPath = Skia.Path.Make();
      for (const event of summary.events) {
        if (event.status !== "onTime") continue;
        const t = event.elapsedMs + event.deltaMs;
        if (t < barStart || t >= barEnd) continue;
        const x = (t - barStart) * pxPerMs;
        onsetPath.moveTo(x, TOP_LABEL_LANE);
        onsetPath.lineTo(x, TOP_LABEL_LANE + CHART_HEIGHT);
      }

      result.push({
        barNumber: bar + 1,
        waveformPath,
        quarterTickPath,
        sixteenthTickPath,
        barlinePath,
        onsetPath,
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
    summary.events,
    summary.maxBars,
  ]);

  return (
    <View className="gap-2">
      <Text className="text-neutral-600 text-[10px] leading-4">
        Una riga per battuta. Le righe bianche numerate segnano i quarti, le
        lineette più corte i sedicesimi. Per ogni colpo a tempo, una linea
        verde segna il timestamp reale del picco rilevato dal microfono.
      </Text>

      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        <LegendLine color={WAVEFORM_FILL_COLOR} label="livello microfono" />
        <LegendLine color={QUARTER_TICK_COLOR} label="quarto" />
        <LegendLine color={ONSET_STATUS_COLOR.onTime} label="colpo a tempo" />
      </View>

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {rows.map((row) => (
          <View key={row.barNumber} style={{ marginBottom: ROW_GAP }}>
            <Text className="text-white/50 text-[10px] font-bold uppercase tracking-widest mb-1">
              Battuta {row.barNumber}
            </Text>
            <View style={{ width, height: CHART_TOTAL_HEIGHT }}>
              <Canvas style={{ width, height: CHART_TOTAL_HEIGHT }}>
                <Path path={row.waveformPath} color={WAVEFORM_FILL_COLOR} style="fill" />
                <Path path={row.sixteenthTickPath} color={SIXTEENTH_TICK_COLOR} style="stroke" strokeWidth={1} />
                <Path path={row.quarterTickPath} color={QUARTER_TICK_COLOR} style="stroke" strokeWidth={1} />
                <Path path={row.barlinePath} color={BARLINE_COLOR} style="stroke" strokeWidth={2} />
                <Path path={row.onsetPath} color={ONSET_STATUS_COLOR.onTime} style="stroke" strokeWidth={2} />
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
