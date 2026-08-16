import DarkPanel from "@/components/dark-panel";
import DebugChart from "@/components/debug-chart";
import type {
  OnsetEvent,
  OnsetStatus,
  SessionSummary,
  Subdivision,
} from "@/components/sync-recorder";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ACCENT_COLOR = "#FF3B30";
const DIM_COLOR = "rgba(255,255,255,0.35)";

const STATUS_META: Record<OnsetStatus, { label: string }> = {
  onTime: { label: "ON TIME" },
  early: { label: "EARLY" },
  late: { label: "LATE" },
};

// A zero count is de-emphasized (dim grey) regardless of category; a
// nonzero count is white for onTime, red for early/late — early and late
// aren't told apart by color here, same simplification already used for
// the debug chart's onset lines and the event chips below.
function countColor(count: number, isOnTime: boolean) {
  if (count === 0) return DIM_COLOR;
  return isOnTime ? "#FFFFFF" : ACCENT_COLOR;
}

// Same "beat-subdivision" scheme already used in the debug chart's grid
// labels: plain beat number for quarters, a fixed "-5" suffix for the
// eighth's levare, and "beat-subBeat" for triplet/sixteenth (including the
// battere itself, subBeatIndex 0, as "-1").
function eventLabel(event: OnsetEvent, subdivision: Subdivision): string {
  const beatNumber = event.beatIndex + 1;
  if (subdivision === "quarter") return String(beatNumber);
  if (subdivision === "eighth") {
    return event.subBeatIndex === 0 ? String(beatNumber) : `${beatNumber}-5`;
  }
  return `${beatNumber}-${event.subBeatIndex + 1}`;
}

function StatCount({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <View className="items-center gap-1">
      <Text className="text-2xl font-bold" style={{ color }}>
        {count}
      </Text>
      <Text className="text-neutral-500 text-[9px] font-semibold tracking-widest">
        {label}
      </Text>
    </View>
  );
}

function EventChip({
  event,
  subdivision,
}: {
  event: OnsetEvent;
  subdivision: Subdivision;
}) {
  const color = event.status === "onTime" ? "#FFFFFF" : ACCENT_COLOR;
  return (
    <View
      className="items-center rounded-xl px-2.5 py-1.5 gap-0.5"
      style={{ borderWidth: 1, borderColor: color }}
    >
      <Text className="text-xs font-bold" style={{ color }}>
        {eventLabel(event, subdivision)}
      </Text>
      <Text className="text-[9px] font-semibold" style={{ color }}>
        {event.deltaMs > 0 ? "+" : ""}
        {Math.round(event.deltaMs)}ms
      </Text>
    </View>
  );
}

type SessionReportProps = {
  summary: SessionSummary;
  // Both the top-left back arrow and the bottom "New session" button
  // call this — same destination (the metronome/recording screen, see
  // app/index.tsx), just two different affordances for reaching it.
  onNewSession: () => void;
};

export default function SessionReport({ summary, onNewSession }: SessionReportProps) {
  const insets = useSafeAreaInsets();

  const sortedEvents = [...summary.events].sort(
    (a, b) => a.elapsedMs - b.elapsedMs,
  );
  // Denominator is expected hits (one diagnostic per beat slot, matched or
  // not), not detected events — otherwise missed beats silently vanish from
  // both sides of the ratio and a session with 2/16 real hits can read 100%.
  const total = summary.hitDiagnostics.length;
  const onTimeCount = summary.hitDiagnostics.filter((h) => h.status === "onTime").length;
  const earlyCount = summary.hitDiagnostics.filter((h) => h.status === "early").length;
  const lateCount = summary.hitDiagnostics.filter((h) => h.status === "late").length;
  const accuracy = total > 0 ? Math.round((onTimeCount / total) * 100) : null;

  return (
    <LinearGradient
      colors={["#242426", "#1C1C1E", "#141416"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <Pressable
        onPress={onNewSession}
        className="absolute w-10 h-10 rounded-full items-center justify-center active:opacity-60"
        style={{
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.12)",
        }}
      >
        <Text className="text-white text-lg">←</Text>
      </Pressable>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 40,
          gap: 20,
        }}
      >
        <Text
          className="text-center text-lg font-extrabold uppercase tracking-[3px]"
          style={{ color: ACCENT_COLOR }}
        >
          Session report
        </Text>

        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />

        <DarkPanel className="px-4 py-5 gap-4 w-full items-center">
          <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
            Result
          </Text>

          {total === 0 ? (
            <Text className="text-white/70 text-sm text-center px-4">
              No hits detected in this session.
            </Text>
          ) : (
            <>
              <Text
                className="text-6xl font-bold"
                style={{
                  color: ACCENT_COLOR,
                  textShadowColor: "rgba(255,59,48,0.55)",
                  textShadowRadius: 20,
                  textShadowOffset: { width: 0, height: 0 },
                }}
              >
                {accuracy}%
              </Text>
              <Text className="text-white/60 text-xs font-semibold">
                {onTimeCount} of {total} hits on time
              </Text>

              <View className="flex-row justify-center gap-8 mt-1">
                <StatCount
                  color={countColor(onTimeCount, true)}
                  label={STATUS_META.onTime.label}
                  count={onTimeCount}
                />
                <StatCount
                  color={countColor(earlyCount, false)}
                  label={STATUS_META.early.label}
                  count={earlyCount}
                />
                <StatCount
                  color={countColor(lateCount, false)}
                  label={STATUS_META.late.label}
                  count={lateCount}
                />
              </View>

              <View className="flex-row flex-wrap justify-center gap-2 mt-2">
                {sortedEvents.map((event) => (
                  <EventChip key={event.id} event={event} subdivision={summary.subdivision} />
                ))}
              </View>
            </>
          )}
        </DarkPanel>

        <DarkPanel className="px-4 py-4 gap-3 w-full">
          <Text
            className="text-[11px] font-bold uppercase tracking-[2px]"
            style={{ color: ACCENT_COLOR }}
          >
            Timing Analysis
          </Text>
          <DebugChart summary={summary} />
        </DarkPanel>

        <Pressable
          onPress={onNewSession}
          className="self-stretch py-5 rounded-2xl items-center active:opacity-70 border-2"
          style={{
            borderColor: ACCENT_COLOR,
            shadowColor: ACCENT_COLOR,
            shadowOpacity: 0.5,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          <Text
            className="text-xl font-extrabold uppercase tracking-widest"
            style={{
              color: ACCENT_COLOR,
              textShadowColor: "rgba(255,59,48,0.6)",
              textShadowRadius: 12,
              textShadowOffset: { width: 0, height: 0 },
            }}
          >
            New session
          </Text>
        </Pressable>
      </ScrollView>
    </LinearGradient>
  );
}
