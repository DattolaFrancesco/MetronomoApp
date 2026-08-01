import {
  BEATS_PER_BAR,
  CLICK_GATE_MS,
  MIN_PEAK_AMPLITUDE,
  WAVEFORM_SAMPLE_INTERVAL_MS,
  type PeakRejectReason,
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

// Dev/QA-only visualization: dense, unstyled-on-purpose, one marker per
// signal the detection pipeline actually looks at. Not meant to be pretty —
// meant to make "why didn't beat 7 register a hit" answerable at a glance.

const CHART_HEIGHT = 220;
const TOP_LABEL_LANE = 34; // reserved strip above the waveform for bar/beat labels
const CHART_TOTAL_HEIGHT = CHART_HEIGHT + TOP_LABEL_LANE;

// Horizontal scale, in pixels per millisecond of session time. Zoom changes
// this (discretely, on pinch-end — see the Pinch gesture below), which
// changes every layer's layout together since they all key off it.
const BASE_PX_PER_MS = 0.35;
const MIN_PX_PER_MS = 0.06;
const MAX_PX_PER_MS = 1.6;

const WAVEFORM_COLOR = "rgba(57,255,106,0.55)";
const THRESHOLD_LINE_COLOR = "#FFD60A";
const BARLINE_COLOR = "rgba(255,255,255,0.6)";
const QUARTER_TICK_COLOR = "rgba(255,255,255,0.3)";
const EIGHTH_TICK_COLOR = "rgba(255,255,255,0.14)";
const GATE_SHADE_COLOR = "rgba(255,69,58,0.22)";
const ACCEPTED_COLOR = "#39FF6A";

const REJECTED_META: Record<
  PeakRejectReason,
  { color: string; label: string }
> = {
  belowThreshold: { color: "#8E8E93", label: "sotto soglia" },
  gated: { color: "#FF453A", label: "gating" },
  clickMatch: { color: "#BF5AF2", label: "click rilevato" },
};

function formatSigned(value: number) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}ms`;
}

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

  const thresholdY = CHART_HEIGHT * (1 - MIN_PEAK_AMPLITUDE);

  return (
    <View className="gap-2">
      <Text className="text-neutral-600 text-[10px] leading-4">
        Waveform grezza (bucket da {WAVEFORM_SAMPLE_INTERVAL_MS}ms) + griglia
        beat attesi + finestre di esclusione click + esito di ogni picco
        rilevato. Pizzica per zoomare, scorri in orizzontale per navigare.
      </Text>

      <View className="flex-row flex-wrap gap-x-3 gap-y-1">
        <LegendDot color={ACCEPTED_COLOR} label="colpo accettato" />
        <LegendDot color={REJECTED_META.belowThreshold.color} label="sotto soglia" />
        <LegendDot color={REJECTED_META.gated.color} label="dentro gating" />
        <LegendDot color={REJECTED_META.clickMatch.color} label="click rilevato" />
        <LegendDot color={THRESHOLD_LINE_COLOR} label="soglia minima" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator style={{ height: CHART_TOTAL_HEIGHT + 40 }}>
        <GestureDetector gesture={pinchGesture}>
          <Animated.View style={[{ width: contentWidth, height: CHART_TOTAL_HEIGHT + 40 }, previewStyle]}>
            {/* Click-exclusion shading, one rect per quarter beat */}
            {grid
              .filter((t): t is Extract<GridTick, { type: "quarter" }> => t.type === "quarter")
              .map((t) => (
                <View
                  key={`gate-${t.time}`}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: t.time * pxPerMs,
                    top: TOP_LABEL_LANE,
                    width: Math.max(1, CLICK_GATE_MS * pxPerMs),
                    height: CHART_HEIGHT,
                    backgroundColor: GATE_SHADE_COLOR,
                  }}
                />
              ))}

            {/* Threshold reference line */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: TOP_LABEL_LANE + thresholdY,
                height: 1,
                backgroundColor: THRESHOLD_LINE_COLOR,
                opacity: 0.6,
              }}
            />

            {/* Raw waveform bars */}
            {summary.waveform.map((value, index) => {
              const barW = Math.max(1, WAVEFORM_SAMPLE_INTERVAL_MS * pxPerMs - 0.5);
              return (
                <View
                  key={`wf-${index}`}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: index * WAVEFORM_SAMPLE_INTERVAL_MS * pxPerMs,
                    top: TOP_LABEL_LANE + CHART_HEIGHT - value * CHART_HEIGHT,
                    width: barW,
                    height: Math.max(1, value * CHART_HEIGHT),
                    backgroundColor: WAVEFORM_COLOR,
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

            {/* Accepted onsets */}
            {summary.events.map((event) => {
              const onsetElapsed = event.elapsedMs + event.deltaMs;
              const y = TOP_LABEL_LANE + CHART_HEIGHT - event.amplitude * CHART_HEIGHT;
              return (
                <View
                  key={`acc-${event.id}`}
                  pointerEvents="none"
                  style={{ position: "absolute", left: onsetElapsed * pxPerMs - 4, top: y - 4 }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: ACCEPTED_COLOR,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 8,
                      color: ACCEPTED_COLOR,
                      marginTop: 1,
                      width: 70,
                    }}
                  >
                    {Math.round(event.amplitude * 100)}% {formatSigned(event.deltaMs)}
                  </Text>
                </View>
              );
            })}

            {/* Rejected peaks, colored + labeled by reason */}
            {summary.rejectedPeaks.map((peak) => {
              const meta = REJECTED_META[peak.reason];
              const y = TOP_LABEL_LANE + CHART_HEIGHT - peak.amplitude * CHART_HEIGHT;
              return (
                <View
                  key={`rej-${peak.id}`}
                  pointerEvents="none"
                  style={{ position: "absolute", left: peak.elapsedMs * pxPerMs - 4, top: y - 4 }}
                >
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: meta.color,
                      opacity: 0.9,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 8,
                      color: meta.color,
                      marginTop: 1,
                      width: 80,
                    }}
                  >
                    {meta.label} · {Math.round(peak.amplitude * 100)}%
                  </Text>
                </View>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </ScrollView>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color }} />
      <Text className="text-neutral-500 text-[9px]">{label}</Text>
    </View>
  );
}
