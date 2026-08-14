import {
  BEATS_PER_BAR,
  MIN_ONSET_RISE,
  MIN_PEAK_AMPLITUDE,
  type HitDiagnostic,
  type SessionSummary,
  type Subdivision,
} from "@/components/sync-recorder";
import { Text, View } from "react-native";

// Dev/QA-only companion to DebugChart: one row per expected hit (matched or
// not), showing the raw numbers behind the accept/reject decision — same
// "strongest peak found + rise" read the chart itself can't spell
// out. Exists so a missed hit's *cause* (too quiet vs no real rise vs
// nothing there) is visible without re-deriving it from the waveform by eye.

const OK_COLOR = "#FFFFFF";
const MISS_COLOR = "#FF3B30";
const DIM_COLOR = "rgba(255,255,255,0.35)";

const STATUS_LABEL: Record<string, string> = {
  onTime: "ON TIME",
  early: "EARLY",
  late: "LATE",
};

// Same beat-subdivision labeling convention used by session-report's event
// chips (plain number for quarters, "-5" for the eighth's levare, "beat-sub"
// for triplet/sixteenth), duplicated here rather than shared since it
// operates on HitDiagnostic (beatIndex/subBeatIndex), not OnsetEvent.
function hitLabel(hit: HitDiagnostic, subdivision: Subdivision): string {
  const beatNumber = hit.beatIndex + 1;
  if (subdivision === "quarter") return String(beatNumber);
  if (subdivision === "eighth") {
    return hit.subBeatIndex === 0 ? String(beatNumber) : `${beatNumber}-5`;
  }
  return `${beatNumber}-${hit.subBeatIndex + 1}`;
}

function fmtAmp(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

type DebugHitTableProps = {
  summary: SessionSummary;
};

export default function DebugHitTable({ summary }: DebugHitTableProps) {
  const beatIntervalMs = 60000 / summary.bpm;
  const barDurationMs = beatIntervalMs * BEATS_PER_BAR;

  return (
    <View className="gap-2">
      <Text className="text-neutral-600 text-[10px] leading-4">
        For each quarter: outcome, the strongest peak found in the listening
        window, and how much it rose from the preceding minimum — compared
        against the minimum thresholds (amplitude {MIN_PEAK_AMPLITUDE.toFixed(2)}, rise{" "}
        {MIN_ONSET_RISE.toFixed(2)}).
      </Text>

      <View className="gap-1.5">
        {summary.hitDiagnostics.map((hit, i) => {
          const barNumber = Math.floor(hit.expectedTimeMs / barDurationMs) + 1;
          const showBarHeader =
            i === 0 ||
            Math.floor(
              summary.hitDiagnostics[i - 1].expectedTimeMs / barDurationMs,
            ) !==
              barNumber - 1;

          return (
            <View key={`${hit.beatIndex}-${hit.subBeatIndex}-${i}`}>
              {showBarHeader && (
                <Text className="text-white text-[10px] font-bold uppercase tracking-widest mt-1 mb-0.5">
                  Bar {barNumber}
                </Text>
              )}
              <View
                className="flex-row items-center justify-between rounded-lg px-2.5 py-1.5"
                style={{
                  backgroundColor: "rgba(255,255,255,0.04)",
                  borderWidth: 1,
                  borderColor: hit.matched
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(255,59,48,0.35)",
                }}
              >
                <Text
                  className="text-xs font-bold"
                  style={{ color: hit.matched ? OK_COLOR : MISS_COLOR }}
                >
                  {hitLabel(hit, summary.subdivision)}
                </Text>

                <Text
                  className="text-[10px] font-semibold"
                  style={{ color: hit.matched ? OK_COLOR : MISS_COLOR }}
                >
                  {hit.matched
                    ? `${STATUS_LABEL[hit.status!]} (${hit.deltaMs! > 0 ? "+" : ""}${Math.round(hit.deltaMs!)}ms)`
                    : "NOT DETECTED"}
                </Text>

                <Text className="text-[10px]" style={{ color: DIM_COLOR }}>
                  peak{" "}
                  <Text style={{ color: hit.passedAmplitude ? OK_COLOR : MISS_COLOR }}>
                    {fmtAmp(hit.candidateAmplitude)}
                  </Text>
                </Text>

                <Text className="text-[10px]" style={{ color: DIM_COLOR }}>
                  rise{" "}
                  <Text style={{ color: hit.passedRise ? OK_COLOR : MISS_COLOR }}>
                    {fmtAmp(hit.candidateRise)}
                  </Text>
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
