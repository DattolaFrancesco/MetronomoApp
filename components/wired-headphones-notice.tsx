import DarkPanel from "@/components/dark-panel";
import LoadingScreen from "@/components/loading-screen";
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
          For accurate results, use wired headphones
        </Text>

        <Text className="text-white/70 text-base text-center leading-6">
          This app measures your timing down to the millisecond. Bluetooth
          headphones add audio delay that throws off the measurement — even a
          great pair can be off by 100ms or more. For precise results, use
          wired headphones. This also keeps the mic from picking up the
          metronome’s own click.
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
            Don’t show this again
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
            Got it
          </Text>
        </Pressable>
      </DarkPanel>
    </View>
  );
}
