import DarkPanel from "@/components/dark-panel";
import { Pressable, Text, View } from "react-native";

// UI-only for now (see app/index.tsx) — no wiring to the metronome engine,
// SyncRecorder, or session start/stop yet. Bars/subdivision selection is
// purely local visual state until that logic is connected later.
export type SetupSubdivision = "quarter" | "eighth" | "triplet" | "sixteenth";

const ACTIVE_COLOR = "#39FF6A";
const SQUARE_SIZE = 44;

const BARS_OPTIONS = [1, 2, 3, 4] as const;

const TEMPO_OPTIONS: { key: SetupSubdivision; label: string }[] = [
  { key: "quarter", label: "Quarti" },
  { key: "eighth", label: "Ottavi" },
  { key: "triplet", label: "Terzine" },
  { key: "sixteenth", label: "Quartine" },
];

function SelectSquare({ selected }: { selected: boolean }) {
  return (
    <View
      style={{
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: selected ? ACTIVE_COLOR : "rgba(255,255,255,0.25)",
        backgroundColor: selected ? "rgba(57,255,106,0.15)" : "transparent",
      }}
    />
  );
}

type SessionSetupProps = {
  bars: number;
  onBarsChange: (bars: number) => void;
  subdivision: SetupSubdivision;
  onSubdivisionChange: (subdivision: SetupSubdivision) => void;
  onStart: () => void;
};

export default function SessionSetup({
  bars,
  onBarsChange,
  subdivision,
  onSubdivisionChange,
  onStart,
}: SessionSetupProps) {
  return (
    <View className="gap-4">
      <DarkPanel className="px-5 py-5 gap-4">
        <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
          Numero battute
        </Text>
        <View className="flex-row justify-between">
          {BARS_OPTIONS.map((n) => (
            <Pressable
              key={n}
              onPress={() => onBarsChange(n)}
              className="items-center gap-1.5 active:opacity-70"
            >
              <Text className="text-white text-xs font-semibold">{n}</Text>
              <SelectSquare selected={bars === n} />
            </Pressable>
          ))}
        </View>
      </DarkPanel>

      <DarkPanel className="px-5 py-5 gap-4">
        <Text className="text-neutral-500 text-[11px] font-semibold uppercase tracking-widest">
          Tempo
        </Text>
        <View className="flex-row justify-between">
          {TEMPO_OPTIONS.map(({ key, label }) => {
            const selected = subdivision === key;
            return (
              <Pressable
                key={key}
                onPress={() => onSubdivisionChange(key)}
                className="items-center gap-2 active:opacity-70"
              >
                <Text
                  className="text-xs font-semibold"
                  style={{ color: selected ? ACTIVE_COLOR : "#F2F2F7" }}
                >
                  {label}
                </Text>
                <SelectSquare selected={selected} />
              </Pressable>
            );
          })}
        </View>
      </DarkPanel>

      <Pressable
        onPress={onStart}
        className="self-center px-16 py-5 rounded-full active:opacity-80 mt-2"
        style={{ backgroundColor: ACTIVE_COLOR }}
      >
        <Text className="text-black text-xl font-bold">Inizia</Text>
      </Pressable>
    </View>
  );
}
