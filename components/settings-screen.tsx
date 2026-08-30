import DarkPanel from "@/components/dark-panel";
import { useTranslation, type Language } from "@/lib/i18n";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ACCENT_COLOR = "#FF3B30";

type SettingsScreenProps = {
  onBack: () => void;
  onReplayMainTour: () => void;
  onReplayChallengeTour: () => void;
};

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      className="text-[11px] font-bold uppercase tracking-[2px]"
      style={{ color: ACCENT_COLOR }}
    >
      {children}
    </Text>
  );
}

// Same selectable-row visual language as the Microphone/Tap toggle in
// session-setup.tsx (lines 267-306) — border/background switch to
// ACCENT_COLOR when selected, instant-apply on press (no separate save step).
function LanguageOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 py-3 rounded-xl items-center active:opacity-60"
      style={{
        borderWidth: 2,
        borderColor: selected ? ACCENT_COLOR : "rgba(255,255,255,0.15)",
        backgroundColor: selected ? "rgba(255,59,48,0.12)" : "transparent",
      }}
    >
      <Text
        className="text-sm font-bold"
        style={{ color: selected ? ACCENT_COLOR : "#8E8E93" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TutorialRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="active:opacity-70">
      <DarkPanel className="px-4 py-4 flex-row items-center justify-between">
        <Text className="text-white text-sm font-semibold">{label}</Text>
        <Text className="text-white/40 text-lg">›</Text>
      </DarkPanel>
    </Pressable>
  );
}

export default function SettingsScreen({
  onBack,
  onReplayMainTour,
  onReplayChallengeTour,
}: SettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { t, language, setLanguage } = useTranslation();

  const selectLanguage = (next: Language) => setLanguage(next);

  return (
    <LinearGradient
      colors={["#242426", "#1C1C1E", "#141416"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <Pressable
        onPress={onBack}
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

      <View
        className="flex-1 px-6 gap-8"
        style={{
          paddingTop: insets.top + 68,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <Text
          className="text-center text-lg font-extrabold uppercase tracking-[3px]"
          style={{ color: ACCENT_COLOR }}
        >
          {t("settings.title")}
        </Text>

        <View className="gap-3">
          <SectionLabel>{t("settings.language.sectionTitle")}</SectionLabel>
          <View className="flex-row gap-2">
            <LanguageOption
              label={t("settings.language.english")}
              selected={language === "en"}
              onPress={() => selectLanguage("en")}
            />
            <LanguageOption
              label={t("settings.language.italian")}
              selected={language === "it"}
              onPress={() => selectLanguage("it")}
            />
          </View>
        </View>

        <View className="gap-3">
          <SectionLabel>{t("settings.tutorials.sectionTitle")}</SectionLabel>
          <View className="gap-2.5">
            <TutorialRow label={t("settings.tutorials.replayMain")} onPress={onReplayMainTour} />
            <TutorialRow label={t("settings.tutorials.replayChallenge")} onPress={onReplayChallengeTour} />
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}
