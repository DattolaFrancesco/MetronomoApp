import DarkPanel from "@/components/dark-panel";
import DebugChart from "@/components/debug-chart";
import type { SessionSummary } from "@/components/sync-recorder";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type SessionReportProps = {
  summary: SessionSummary;
  // Both the top-left back arrow and the bottom "Nuova sessione" button
  // call this — same destination (the metronome/recording screen, see
  // app/index.tsx), just two different affordances for reaching it.
  onNewSession: () => void;
};

export default function SessionReport({ summary, onNewSession }: SessionReportProps) {
  const insets = useSafeAreaInsets();

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
