import DarkPanel from "@/components/dark-panel";
import LoadingScreen from "@/components/loading-screen";
import { useTranslation } from "@/lib/i18n";
import {
  getHasDismissedWiredHeadphonesNotice,
  markWiredHeadphonesNoticeDismissed,
} from "@/lib/onboarding";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

const ACCENT_COLOR = "#FF3B30";

type Props = {
  onDone: () => void;
};

// Shown before anything else in the app — checks AsyncStorage on mount
// and, if the user previously checked "Don't show this again", calls
// onDone immediately without ever rendering (same self-gating idiom as
// MicPermissionGate). Dismissing this via "Got it" alone does *not*
// persist anything — it's meant to reappear on every launch until the
// user opts out via the checkbox, since Bluetooth latency is a
// per-session, easy-to-forget risk to the app's core measurement, not a
// one-time thing to learn.
export default function WiredHeadphonesNotice({ onDone }: Props) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(true);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHasDismissedWiredHeadphonesNotice().then((dismissed) => {
      if (cancelled) return;
      if (dismissed) {
        onDone();
        return;
      }
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) return <LoadingScreen />;

  const handleGotIt = () => {
    if (dontShowAgain) {
      markWiredHeadphonesNoticeDismissed();
    }
    onDone();
  };

  return (
    <View
      className="flex-1 items-center justify-center px-6"
      style={{ backgroundColor: "rgba(0,0,0,0.72)" }}
    >
      <DarkPanel className="px-6 py-7 gap-5 self-stretch" style={{ borderColor: "rgba(255,59,48,0.35)" }}>
        <Text
          className="text-center text-xl font-extrabold leading-6"
          style={{ color: ACCENT_COLOR }}
        >
          {t("wiredHeadphonesNotice.title")}
        </Text>

        <Text className="text-white/70 text-base text-center leading-6">
          {t("wiredHeadphonesNotice.body")}
        </Text>

        <Pressable
          onPress={() => setDontShowAgain((v) => !v)}
          className="flex-row items-center gap-2.5 self-center active:opacity-70"
        >
          <View
            className="items-center justify-center"
            style={{
              width: 20,
              height: 20,
              borderRadius: 5,
              borderWidth: 2,
              borderColor: dontShowAgain ? ACCENT_COLOR : "rgba(255,255,255,0.3)",
              backgroundColor: dontShowAgain ? ACCENT_COLOR : "transparent",
            }}
          >
            {dontShowAgain && (
              <Text
                className="text-xs font-extrabold"
                style={{ color: "#141416", lineHeight: 14 }}
              >
                ✓
              </Text>
            )}
          </View>
          <Text className="text-white/60 text-sm font-semibold">
            {t("wiredHeadphonesNotice.dontShowAgain")}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleGotIt}
          className="self-stretch py-4 rounded-2xl items-center active:opacity-70 border-2"
          style={{
            borderColor: ACCENT_COLOR,
            shadowColor: ACCENT_COLOR,
            shadowOpacity: 0.5,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          <Text
            className="text-lg font-extrabold uppercase tracking-widest"
            style={{ color: ACCENT_COLOR }}
          >
            {t("wiredHeadphonesNotice.gotIt")}
          </Text>
        </Pressable>
      </DarkPanel>
    </View>
  );
}
