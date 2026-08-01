import DarkPanel from "@/components/dark-panel";
import DebugChart from "@/components/debug-chart";
import type { OnsetEvent, SessionSummary } from "@/components/sync-recorder";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BEATS_PER_BAR = 4;

// Rhythm (percussion) staff: a single line, quarter notes only (this app
// never records anything but quarters — see OnsetEvent), grouped into bars
// of BEATS_PER_BAR with vertical barlines. No pitch is implied, so every
// notehead sits directly on the one line regardless of the hit's timing.
// This is the report's main/only visualization, so it's sized generously.
const RHYTHM_NOTE_SPACING = 56; // horizontal slot width per note
const RHYTHM_BARLINE_GAP = 20; // extra horizontal space reserved for a barline
const RHYTHM_ROW_HEIGHT = 120;
const RHYTHM_STAFF_Y = 84; // distance from the top of the row to the single staff line
const RHYTHM_STEM_HEIGHT = 36;
const RHYTHM_NOTEHEAD_WIDTH = 16;
const RHYTHM_NOTEHEAD_HEIGHT = 12;
const RHYTHM_DOT_SIZE = 12;
const RHYTHM_DOT_GAP = 8; // gap between the stem tip and the status dot above it
const RHYTHM_BARLINE_HEIGHT = 44;
const RHYTHM_NOTE_COLOR = "#F2F2F7";
const RHYTHM_STAFF_COLOR = "rgba(255,255,255,0.3)";
const RHYTHM_BARLINE_COLOR = "rgba(255,255,255,0.4)";
// The status dot's horizontal offset from the notehead's center is
// proportional to the hit's deltaMs (negative = early, positive = late),
// clamped so even a very large deviation stays within the note's own slot
// instead of overlapping a neighboring note or barline.
const RHYTHM_DOT_MAX_OFFSET_PX = 16;
const RHYTHM_DOT_OFFSET_RANGE_MS = 100;

type RhythmItem =
  | { type: "note"; event: OnsetEvent; left: number }
  | { type: "barline"; left: number };

const STATUS_META: Record<OnsetEvent["status"], { color: string; label: string }> = {
  onTime: { color: "#39FF6A", label: "A tempo" },
  early: { color: "#FF9F0A", label: "Anticipo" },
  late: { color: "#FF453A", label: "Ritardo" },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type SessionReportProps = {
  summary: SessionSummary;
  onNewSession: () => void;
};

export default function SessionReport({ summary, onNewSession }: SessionReportProps) {
  const insets = useSafeAreaInsets();

  // Lays out one quarter note per event left-to-right, inserting a barline
  // item after every complete bar of BEATS_PER_BAR notes and after the very
  // last note (closing barline), even if that last bar is incomplete.
  const rhythmView = useMemo(() => {
    const items: RhythmItem[] = [];
    let cursor = 0;

    summary.events.forEach((event, index) => {
      items.push({ type: "note", event, left: cursor });
      cursor += RHYTHM_NOTE_SPACING;

      const endsBar = (index + 1) % BEATS_PER_BAR === 0;
      const isLastEvent = index === summary.events.length - 1;
      if (endsBar || isLastEvent) {
        items.push({ type: "barline", left: cursor + RHYTHM_BARLINE_GAP / 2 });
        cursor += RHYTHM_BARLINE_GAP;
      }
    });

    return { items, width: cursor };
  }, [summary.events]);

  return (
    <ScrollView
      className="flex-1 bg-black"
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

      {rhythmView.items.length > 0 && (
        <DarkPanel className="px-4 py-4 gap-3 w-full">
          <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
            Notazione ritmica · Quarti
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            style={{ height: RHYTHM_ROW_HEIGHT }}
          >
            <View style={{ height: RHYTHM_ROW_HEIGHT, width: rhythmView.width }}>
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: RHYTHM_STAFF_Y,
                  height: 1.5,
                  backgroundColor: RHYTHM_STAFF_COLOR,
                }}
              />

              {rhythmView.items.map((item, index) => {
                if (item.type === "barline") {
                  return (
                    <View
                      key={`bar-${index}`}
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: item.left,
                        top: RHYTHM_STAFF_Y - RHYTHM_BARLINE_HEIGHT / 2,
                        width: 2,
                        height: RHYTHM_BARLINE_HEIGHT,
                        backgroundColor: RHYTHM_BARLINE_COLOR,
                      }}
                    />
                  );
                }

                const centerX = item.left + RHYTHM_NOTE_SPACING / 2;
                const stemLeft = centerX + RHYTHM_NOTEHEAD_WIDTH / 2 - 1.5;
                const stemTop = RHYTHM_STAFF_Y - RHYTHM_STEM_HEIGHT;
                const dotColor = STATUS_META[item.event.status].color;
                // Negative deltaMs (early) -> dot shifts left of center;
                // positive (late) -> right; ~0 (on time) -> centered.
                // Clamped so a very large deviation still lands inside this
                // note's own slot.
                const dotOffset = clamp(
                  (item.event.deltaMs / RHYTHM_DOT_OFFSET_RANGE_MS) *
                    RHYTHM_DOT_MAX_OFFSET_PX,
                  -RHYTHM_DOT_MAX_OFFSET_PX,
                  RHYTHM_DOT_MAX_OFFSET_PX,
                );

                return (
                  <View key={item.event.id}>
                    <View
                      style={{
                        position: "absolute",
                        left: centerX - RHYTHM_NOTEHEAD_WIDTH / 2,
                        top: RHYTHM_STAFF_Y - RHYTHM_NOTEHEAD_HEIGHT / 2,
                        width: RHYTHM_NOTEHEAD_WIDTH,
                        height: RHYTHM_NOTEHEAD_HEIGHT,
                        borderRadius: RHYTHM_NOTEHEAD_HEIGHT / 2,
                        backgroundColor: RHYTHM_NOTE_COLOR,
                      }}
                    />
                    <View
                      style={{
                        position: "absolute",
                        left: stemLeft,
                        top: stemTop,
                        width: 1.5,
                        height: RHYTHM_STEM_HEIGHT,
                        backgroundColor: RHYTHM_NOTE_COLOR,
                      }}
                    />
                    <View
                      style={{
                        position: "absolute",
                        left: centerX + dotOffset - RHYTHM_DOT_SIZE / 2,
                        top: stemTop - RHYTHM_DOT_GAP - RHYTHM_DOT_SIZE,
                        width: RHYTHM_DOT_SIZE,
                        height: RHYTHM_DOT_SIZE,
                        borderRadius: RHYTHM_DOT_SIZE / 2,
                        backgroundColor: dotColor,
                      }}
                    />
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <Text className="text-neutral-600 text-[10px] leading-4">
            Un quarto per colpo rilevato, raggruppati a battute di {BEATS_PER_BAR}. Il
            puntino sopra ogni nota segue lo stesso colore di anticipo/a tempo/ritardo
            usato nel resto del report, e si sposta a sinistra o a destra del centro in
            proporzione allo scarto reale in anticipo o ritardo.
          </Text>
        </DarkPanel>
      )}

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
  );
}
