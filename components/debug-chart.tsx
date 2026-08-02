import {
  BEATS_PER_BAR,
  SUBDIVISION_STEPS,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  type OnsetStatus,
  type SessionSummary,
} from "@/components/sync-recorder";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from "react-native-reanimated";

// Dev/QA-only visualization, drawn on a single Skia canvas: a smooth filled
// mic-level waveform, the fixed grid of expected beat/sub-beat positions,
// and one line per accepted onset (green on time, red otherwise). Numeric
// labels stay plain RN Text, absolutely positioned over the canvas — Skia
// text needs a loaded font, which buys nothing over RN's own text layout
// for a handful of small numbers.

const CHART_HEIGHT = 220;
const TOP_LABEL_LANE = 34; // reserved strip above the chart for bar/beat labels
const CHART_TOTAL_HEIGHT = CHART_HEIGHT + TOP_LABEL_LANE;

// Horizontal scale, in pixels per millisecond of session time. Zoom changes
// this (discretely, on pinch-end — see the Pinch gesture below), which
// changes every layer's layout together since they all key off it.
const BASE_PX_PER_MS = 0.35;
const MIN_PX_PER_MS = 0.06;
const MAX_PX_PER_MS = 1.6;

const BARLINE_COLOR = "rgba(255,255,255,0.6)";
const QUARTER_TICK_COLOR = "#FFFFFF";
const SUB_TICK_COLOR = "rgba(255,255,255,0.14)";
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

type GridTick = {
  type: "quarter" | "sub";
  time: number;
  isBarStart: boolean;
  barNumber: number;
  label: string;
};

type DebugChartProps = {
  summary: SessionSummary;
};

export default function DebugChart({ summary }: DebugChartProps) {
  const [pxPerMs, setPxPerMs] = useState(BASE_PX_PER_MS);
  const pxPerMsSV = useSharedValue(BASE_PX_PER_MS);
  pxPerMsSV.value = pxPerMs;
  const previewScale = useSharedValue(1);

  // Not memoized: Gesture objects are cheap, plain descriptors (not native
  // handles), and GestureDetector is meant to receive a fresh one each
  // render — this is the pattern react-native-gesture-handler's own docs use.
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      "worklet";
      const wouldBe = pxPerMsSV.value * e.scale;
      const clamped = Math.min(MAX_PX_PER_MS, Math.max(MIN_PX_PER_MS, wouldBe));
      previewScale.value = clamped / pxPerMsSV.value;
    })
    .onEnd(() => {
      "worklet";
      const next = Math.min(
        MAX_PX_PER_MS,
        Math.max(MIN_PX_PER_MS, pxPerMsSV.value * previewScale.value),
      );
      previewScale.value = 1;
      runOnJS(setPxPerMs)(next);
    });

  const previewStyle = useAnimatedStyle(() => ({
    transform: [{ scale: previewScale.value }],
  }));

  const totalMs = Math.max(
    summary.durationMs,
    summary.waveform.length * WAVEFORM_SAMPLE_INTERVAL_MS,
  );
  const contentWidth = Math.max(1, totalMs * pxPerMs);
  const canvasHeight = CHART_TOTAL_HEIGHT + 40;

  const grid = useMemo(() => {
    const ticks: GridTick[] = [];
    const beatIntervalMs = 60000 / summary.bpm;
    if (!Number.isFinite(beatIntervalMs) || beatIntervalMs <= 0) return ticks;

    const steps = SUBDIVISION_STEPS[summary.subdivision];
    const subIntervalMs = beatIntervalMs / steps;
    const lastQuarter = Math.ceil(totalMs / beatIntervalMs) + 1;

    // Eighths are the one case that keeps the plain beat number on the
    // quarter itself — the quarter is still real, just not what's
    // evaluated (see "il levare" elsewhere). Triplet/sixteenth relabel
    // the quarter as their own first sub-position ("N-1") so all of a
    // beat's points share one consistent beat-subdivision scheme.
    const usesBeatSubdivisionScheme =
      summary.subdivision === "triplet" || summary.subdivision === "sixteenth";

    for (let i = 0; i <= lastQuarter; i++) {
      const quarterTime = i * beatIntervalMs;
      const quarterInBar = i % BEATS_PER_BAR;
      const beatNumber = quarterInBar + 1;

      ticks.push({
        type: "quarter",
        time: quarterTime,
        isBarStart: quarterInBar === 0,
        barNumber: Math.floor(i / BEATS_PER_BAR) + 1,
        label: usesBeatSubdivisionScheme ? `${beatNumber}-1` : String(beatNumber),
      });

      for (let sub = 1; sub < steps; sub++) {
        const subTime = quarterTime + sub * subIntervalMs;
        if (subTime > totalMs + beatIntervalMs) continue;
        const label =
          summary.subdivision === "eighth" ? `${beatNumber}-5` : `${beatNumber}-${sub + 1}`;
        ticks.push({ type: "sub", time: subTime, isBarStart: false, barNumber: 0, label });
      }
    }
    return ticks;
  }, [summary.bpm, summary.subdivision, totalMs]);

  // Smooth filled waveform: each 50ms bucket becomes a point, adjacent
  // points joined through their shared midpoint with a quadratic curve
  // (the standard "smooth line chart" trick) instead of discrete bars —
  // same amplitude data as the live "Input audio" view, just a fluid
  // silhouette here rather than rectangles.
  const waveformPath = useMemo(() => {
    const path = Skia.Path.Make();
    const baseline = TOP_LABEL_LANE + CHART_HEIGHT;
    if (summary.waveform.length === 0) return path;

    const points = summary.waveform.map((amp, i) => ({
      x: i * WAVEFORM_SAMPLE_INTERVAL_MS * pxPerMs,
      y: baseline - Math.max(1, amp * CHART_HEIGHT),
    }));

    path.moveTo(0, baseline);
    path.lineTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      path.quadTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    }
    const last = points[points.length - 1];
    path.lineTo(last.x, last.y);
    path.lineTo(last.x, baseline);
    path.close();
    return path;
  }, [summary.waveform, pxPerMs]);

  // Grid/onset lines grouped by color into as few Paths as possible (one
  // draw call per group instead of one per line) — plenty fast already at
  // this session length (capped at 4 bars), but free to keep simple.
  const barlinePath = useMemo(() => {
    const path = Skia.Path.Make();
    for (const t of grid) {
      if (!t.isBarStart) continue;
      const x = t.time * pxPerMs;
      path.moveTo(x, 0);
      path.lineTo(x, TOP_LABEL_LANE + CHART_HEIGHT);
    }
    return path;
  }, [grid, pxPerMs]);

  const quarterTickPath = useMemo(() => {
    const path = Skia.Path.Make();
    for (const t of grid) {
      if (t.type !== "quarter") continue;
      const x = t.time * pxPerMs;
      path.moveTo(x, TOP_LABEL_LANE);
      path.lineTo(x, TOP_LABEL_LANE + CHART_HEIGHT);
    }
    return path;
  }, [grid, pxPerMs]);

  const subTickPath = useMemo(() => {
    const path = Skia.Path.Make();
    for (const t of grid) {
      if (t.type !== "sub") continue;
      const x = t.time * pxPerMs;
      path.moveTo(x, TOP_LABEL_LANE);
      path.lineTo(x, TOP_LABEL_LANE + CHART_HEIGHT);
    }
    return path;
  }, [grid, pxPerMs]);

  const onTimePath = useMemo(() => {
    const path = Skia.Path.Make();
    for (const event of summary.events) {
      if (event.status !== "onTime") continue;
      const x = (event.elapsedMs + event.deltaMs) * pxPerMs;
      path.moveTo(x, TOP_LABEL_LANE);
      path.lineTo(x, TOP_LABEL_LANE + CHART_HEIGHT);
    }
    return path;
  }, [summary.events, pxPerMs]);

  return (
    <View className="gap-2">
      <Text className="text-neutral-600 text-[10px] leading-4">
        Griglia beat attesi. Per ogni colpo a tempo, una linea verticale verde
        segna il timestamp reale del picco rilevato dal microfono. Pizzica per
        zoomare, scorri in orizzontale per navigare.
      </Text>

      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        <LegendLine color={WAVEFORM_FILL_COLOR} label="livello microfono" />
        <LegendLine color={QUARTER_TICK_COLOR} label="beat atteso" />
        <LegendLine color={ONSET_STATUS_COLOR.onTime} label="colpo a tempo" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator style={{ height: canvasHeight }}>
        <GestureDetector gesture={pinchGesture}>
          <Animated.View style={[{ width: contentWidth, height: canvasHeight }, previewStyle]}>
            <Canvas style={{ width: contentWidth, height: canvasHeight }}>
              <Path path={waveformPath} color={WAVEFORM_FILL_COLOR} style="fill" />
              <Path path={subTickPath} color={SUB_TICK_COLOR} style="stroke" strokeWidth={1} />
              <Path path={quarterTickPath} color={QUARTER_TICK_COLOR} style="stroke" strokeWidth={1} />
              <Path path={barlinePath} color={BARLINE_COLOR} style="stroke" strokeWidth={2} />
              <Path path={onTimePath} color={ONSET_STATUS_COLOR.onTime} style="stroke" strokeWidth={2} />
            </Canvas>

            {/* Numeric labels only — the lines/waveform themselves are the
                canvas above; this layer is just RN Text positioned to
                match each grid tick's x. */}
            {grid.map((t) => (
              <View key={`${t.type}-${t.time}`} pointerEvents="none">
                {t.isBarStart && (
                  <Text
                    style={{
                      position: "absolute",
                      left: t.time * pxPerMs + 4,
                      top: 0,
                      fontSize: 11,
                      fontWeight: "700",
                      color: "#FFFFFF",
                    }}
                  >
                    {t.barNumber}
                  </Text>
                )}
                <Text
                  style={{
                    position: "absolute",
                    left: t.time * pxPerMs + 2,
                    top: TOP_LABEL_LANE - 14,
                    fontSize: t.type === "quarter" ? 9 : 8,
                    fontWeight: t.type === "quarter" ? "600" : "400",
                    color:
                      t.type === "quarter"
                        ? "rgba(255,255,255,0.55)"
                        : "rgba(255,255,255,0.35)",
                  }}
                >
                  {t.label}
                </Text>
              </View>
            ))}
          </Animated.View>
        </GestureDetector>
      </ScrollView>
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
