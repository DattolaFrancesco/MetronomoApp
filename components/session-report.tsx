import DarkPanel from "@/components/dark-panel";
import DebugChart from "@/components/debug-chart";
import type {
  OnsetEvent,
  OnsetStatus,
  SessionSummary,
  Subdivision,
} from "@/components/sync-recorder";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Same look as the classic iOS audio-recording waveform (Voice Memos/Note
// attachments): thin rounded bars, mirrored top/bottom around a fixed-height
// row's vertical center, scrollable rather than squeezed so bar width stays
// readable regardless of session length. Reads summary.waveform directly —
// the exact same amplitude data already backing the Debug chart's bars and
// the live "Input audio" view during recording, just restyled.
const RECORDING_WAVEFORM_HEIGHT = 64;
const RECORDING_WAVEFORM_BAR_WIDTH = 3;
const RECORDING_WAVEFORM_BAR_GAP = 2;
const RECORDING_WAVEFORM_BAR_COLOR = "#E5E5EA";

function RecordingWaveform({ waveform }: { waveform: number[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ height: RECORDING_WAVEFORM_HEIGHT }}
    >
      <View
        className="flex-row items-center"
        style={{ height: RECORDING_WAVEFORM_HEIGHT }}
      >
        {waveform.map((amp, i) => (
          <View
            key={i}
            style={{
              width: RECORDING_WAVEFORM_BAR_WIDTH,
              marginRight: RECORDING_WAVEFORM_BAR_GAP,
              height: Math.max(3, amp * RECORDING_WAVEFORM_HEIGHT),
              borderRadius: RECORDING_WAVEFORM_BAR_WIDTH / 2,
              backgroundColor: RECORDING_WAVEFORM_BAR_COLOR,
            }}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const STATUS_META: Record<
  OnsetStatus,
  { label: string; color: string; bg: string }
> = {
  onTime: { label: "A TEMPO", color: "#39FF6A", bg: "rgba(57,255,106,0.12)" },
  early: { label: "ANTICIPO", color: "#FF9F0A", bg: "rgba(255,159,10,0.12)" },
  late: { label: "RITARDO", color: "#FF453A", bg: "rgba(255,69,58,0.12)" },
};

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
  const meta = STATUS_META[event.status];
  return (
    <View
      className="items-center rounded-xl px-2.5 py-1.5 gap-0.5"
      style={{ backgroundColor: meta.bg, borderWidth: 1, borderColor: `${meta.color}55` }}
    >
      <Text className="text-xs font-bold" style={{ color: meta.color }}>
        {eventLabel(event, subdivision)}
      </Text>
      <Text className="text-[9px] font-semibold" style={{ color: meta.color }}>
        {event.deltaMs > 0 ? "+" : ""}
        {Math.round(event.deltaMs)}ms
      </Text>
    </View>
  );
}

type SessionReportProps = {
  summary: SessionSummary;
  // Both the top-left back arrow and the bottom "Nuova sessione" button
  // call this — same destination (the metronome/recording screen, see
  // app/index.tsx), just two different affordances for reaching it.
  onNewSession: () => void;
};

export default function SessionReport({ summary, onNewSession }: SessionReportProps) {
  const insets = useSafeAreaInsets();

  const sortedEvents = [...summary.events].sort(
    (a, b) => a.elapsedMs - b.elapsedMs,
  );
  const total = sortedEvents.length;
  const onTimeCount = sortedEvents.filter((e) => e.status === "onTime").length;
  const earlyCount = sortedEvents.filter((e) => e.status === "early").length;
  const lateCount = sortedEvents.filter((e) => e.status === "late").length;
  const accuracy = total > 0 ? Math.round((onTimeCount / total) * 100) : null;
  const accuracyColor =
    accuracy === null
      ? "#8E8E93"
      : accuracy >= 80
        ? "#39FF6A"
        : accuracy >= 50
          ? "#FF9F0A"
          : "#FF453A";

  return (
    <View className="flex-1 bg-black">
      <Pressable
        onPress={onNewSession}
        className="absolute w-10 h-10 rounded-full items-center justify-center active:opacity-60"
        style={{
          top: insets.top + 12,
          left: 16,
          zIndex: 10,
          backgroundColor: "rgba(255,255,255,0.08)",
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
          gap: 24,
        }}
      >
        <Text className="text-center text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
          Report sessione
        </Text>

        <DarkPanel className="px-4 py-5 gap-4 w-full items-center">
          <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
            Risultato
          </Text>

          {total === 0 ? (
            <Text className="text-white/70 text-sm text-center px-4">
              Nessun colpo rilevato in questa sessione.
            </Text>
          ) : (
            <>
              <Text className="text-6xl font-bold" style={{ color: accuracyColor }}>
                {accuracy}%
              </Text>
              <Text className="text-neutral-500 text-xs font-semibold">
                {onTimeCount} su {total} colpi a tempo
              </Text>

              <View className="flex-row justify-center gap-8 mt-1">
                <StatCount color={STATUS_META.onTime.color} label="A TEMPO" count={onTimeCount} />
                <StatCount color={STATUS_META.early.color} label="ANTICIPO" count={earlyCount} />
                <StatCount color={STATUS_META.late.color} label="RITARDO" count={lateCount} />
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
          <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
            Waveform registrazione
          </Text>
          <RecordingWaveform waveform={summary.waveform} />
        </DarkPanel>

        <DarkPanel className="px-4 py-4 gap-3 w-full">
          <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
            Debug / Dati tecnici
          </Text>
          <DebugChart summary={summary} />
        </DarkPanel>

        <Pressable
          onPress={onNewSession}
          className="self-center px-16 py-5 rounded-full active:opacity-80"
          style={{ backgroundColor: "#39FF6A" }}
        >
          <Text className="text-black text-xl font-bold">Nuova sessione</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
