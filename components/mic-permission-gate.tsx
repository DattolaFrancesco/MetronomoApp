import LoadingScreen from "@/components/loading-screen";
import { useTranslation } from "@/lib/i18n";
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

const ACCENT_COLOR = "#FF3B30";

type Props = {
  onGranted: () => void;
  // Escape hatch: lets the user pick Tap mode (no microphone needed at
  // all — see components/tap-recorder.tsx) instead of granting/retrying
  // mic access. Optional so any other caller of this gate keeps compiling
  // unchanged if Tap mode isn't wired up for it.
  onUseTapInstead?: () => void;
};

// Shown in place of the setup screen until microphone access is granted.
// On mount it silently checks the current permission and, if it has never
// been asked before ("undetermined"), triggers the native prompt right
// away — the message below only becomes visible if that prompt is denied
// or was already denied in a previous session.
export default function MicPermissionGate({ onGranted, onUseTapInstead }: Props) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(true);
  const [canAskAgain, setCanAskAgain] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let permission = await getRecordingPermissionsAsync();
      if (permission.status === "undetermined") {
        permission = await requestRecordingPermissionsAsync();
      }
      if (cancelled) return;
      if (permission.granted) {
        onGranted();
        return;
      }
      setCanAskAgain(permission.canAskAgain);
      setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePress = async () => {
    if (!canAskAgain) {
      Linking.openSettings();
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (permission.granted) {
      onGranted();
      return;
    }
    setCanAskAgain(permission.canAskAgain);
  };

  if (checking) return <LoadingScreen />;

  return (
    <View className="flex-1 items-center justify-center gap-6 px-2">
      <Text className="text-white text-lg font-extrabold tracking-widest text-center">
        {t("micPermissionGate.title")}
      </Text>
      <Text className="text-white/60 text-center leading-5">
        {t("micPermissionGate.body")}
      </Text>
      <Pressable
        onPress={handlePress}
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
          {canAskAgain ? t("micPermissionGate.allowAccess") : t("micPermissionGate.openSettings")}
        </Text>
      </Pressable>

      {onUseTapInstead && (
        <Pressable onPress={onUseTapInstead} className="active:opacity-60">
          <Text className="text-white/50 text-sm font-semibold underline">
            {t("micPermissionGate.useTapInstead")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
