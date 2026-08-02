import {
  BEATS_PER_BAR,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  type OnsetStatus,
  type SessionSummary,
} from "@/components/sync-recorder";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from "react-native-reanimated";

// Dev/QA-only visualization: two vertical lines per beat and nothing else —
// the fixed grid line marks the expected quarter, the solid onset line marks
// where the mic actually detected the hit. The horizontal gap between them
// *is* the early/on-time/late signal; no labels needed.

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
const EIGHTH_TICK_COLOR = "rgba(255,255,255,0.14)";
const WAVEFORM_BAR_COLOR = "rgba(57,255,106,0.35)";

// Onset line color follows the same on-time/early/late classification
// already computed in sync-recorder.tsx (OnsetEvent.status, against
// toleranceMs) — early and late are both just "not on time" here, one red,
// no need to tell them apart by color in this view.
const ONSET_STATUS_COLOR: Record<OnsetStatus, string> = {
  onTime: "#39FF6A",
  early: "#FF453A",
  late: "#FF453A",
};

type GridTick =
  | { type: "quarter"; time: number; isBarStart: boolean; barNumber: number; label: string }
  | { type: "eighth"; time: number; label: string };

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

  const grid = useMemo(() => {
    const ticks: GridTick[] = [];
    const beatIntervalMs = 60000 / summary.bpm;
    if (!Number.isFinite(beatIntervalMs) || beatIntervalMs <= 0) return ticks;

    const lastQuarter = Math.ceil(totalMs / beatIntervalMs) + 1;
    for (let i = 0; i <= lastQuarter; i++) {
      const quarterTime = i * beatIntervalMs;
      const quarterInBar = i % BEATS_PER_BAR;
      ticks.push({
        type: "quarter",
        time: quarterTime,
        isBarStart: quarterInBar === 0,
        barNumber: Math.floor(i / BEATS_PER_BAR) + 1,
        label: String(quarterInBar + 1),
      });
      const eighthTime = quarterTime + beatIntervalMs / 2;
      if (eighthTime <= totalMs + beatIntervalMs) {
        ticks.push({
          type: "eighth",
          time: eighthTime,
          label: `${quarterInBar + 1}.5`,
        });
      }
    }
    return ticks;
  }, [summary.bpm, totalMs]);

  return (
    <View className="gap-2">
      <Text className="text-neutral-600 text-[10px] leading-4">
        Griglia beat attesi. Per ogni colpo accettato, una linea verticale
        (verde se a tempo, rossa altrimenti) segna il timestamp reale del
        picco rilevato dal microfono — la distanza dalla linea del quarto più
        vicino è lo scarto in anticipo/ritardo. Pizzica per zoomare, scorri in
        orizzontale per navigare.
      </Text>

      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        <LegendLine color={WAVEFORM_BAR_COLOR} label="livello microfono" />
        <LegendLine color={QUARTER_TICK_COLOR} label="beat atteso" />
        <LegendLine color={ONSET_STATUS_COLOR.onTime} label="colpo a tempo" />
        <LegendLine color={ONSET_STATUS_COLOR.early} label="colpo non a tempo" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator style={{ height: CHART_TOTAL_HEIGHT + 40 }}>
        <GestureDetector gesture={pinchGesture}>
          <Animated.View style={[{ width: contentWidth, height: CHART_TOTAL_HEIGHT + 40 }, previewStyle]}>
            {/* Mic level for the whole session — same raw amplitude source
                and bucketing as the live "Input audio" waveform during
                recording (see WAVEFORM_SAMPLE_INTERVAL_MS in
                sync-recorder.tsx), just re-rendered here against the full
                session timeline. Drawn first so the grid/onset lines above
                stay legible on top of it. */}
            {summary.waveform.map((amp, i) => {
              const barHeight = Math.max(1, amp * CHART_HEIGHT);
              return (
                <View
                  key={`wf-${i}`}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: i * WAVEFORM_SAMPLE_INTERVAL_MS * pxPerMs,
                    top: TOP_LABEL_LANE + CHART_HEIGHT - barHeight,
                    width: Math.max(1, WAVEFORM_SAMPLE_INTERVAL_MS * pxPerMs - 1),
                    height: barHeight,
                    backgroundColor: WAVEFORM_BAR_COLOR,
                  }}
                />
              );
            })}

            {/* Beat grid: quarter/eighth ticks + numbered barlines */}
            {grid.map((t) => {
              if (t.type === "eighth") {
                return (
                  <View key={`e-${t.time}`} pointerEvents="none">
                    <View
                      style={{
                        position: "absolute",
                        left: t.time * pxPerMs,
                        top: TOP_LABEL_LANE,
                        width: 1,
                        height: CHART_HEIGHT,
                        backgroundColor: EIGHTH_TICK_COLOR,
                      }}
                    />
                    <Text
                      style={{
                        position: "absolute",
                        left: t.time * pxPerMs + 2,
                        top: TOP_LABEL_LANE - 14,
                        fontSize: 8,
                        color: "rgba(255,255,255,0.35)",
                      }}
                    >
                      {t.label}
                    </Text>
                  </View>
                );
              }
              return (
                <View key={`q-${t.time}`} pointerEvents="none">
                  {t.isBarStart && (
                    <>
                      <View
                        style={{
                          position: "absolute",
                          left: t.time * pxPerMs,
                          top: 0,
                          width: 2,
                          height: TOP_LABEL_LANE + CHART_HEIGHT,
                          backgroundColor: BARLINE_COLOR,
                        }}
                      />
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
                    </>
                  )}
                  <View
                    style={{
                      position: "absolute",
                      left: t.time * pxPerMs,
                      top: TOP_LABEL_LANE,
                      width: 1,
                      height: CHART_HEIGHT,
                      backgroundColor: QUARTER_TICK_COLOR,
                    }}
                  />
                  <Text
                    style={{
                      position: "absolute",
                      left: t.time * pxPerMs + 2,
                      top: TOP_LABEL_LANE - 14,
                      fontSize: 9,
                      fontWeight: "600",
                      color: "rgba(255,255,255,0.55)",
                    }}
                  >
                    {t.label}
                  </Text>
                </View>
              );
            })}

            {/* One solid vertical line per accepted onset, at its real
                detected timestamp (not the expected beat) — the only
                indicator of where the user's hit actually landed. Colored
                by the same on-time/early/late classification the report
                already computes, not a separate calculation here. */}
            {summary.events.map((event) => {
              const onsetElapsed = event.elapsedMs + event.deltaMs;
              return (
                <View
                  key={`onset-${event.id}`}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: onsetElapsed * pxPerMs,
                    top: TOP_LABEL_LANE,
                    width: 2,
                    height: CHART_HEIGHT,
                    backgroundColor: ONSET_STATUS_COLOR[event.status],
                  }}
                />
              );
            })}
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
