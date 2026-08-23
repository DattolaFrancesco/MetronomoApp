import { useEffect } from "react";
import { View, Text } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const ACCENT_COLOR = "#FF3B30";
const BACKGROUND_COLOR = "#1C1C1E";
const BAR_WIDTH = 160;
const KNOB_WIDTH = BAR_WIDTH * 0.4;

// Shown wherever a screen would otherwise flash blank while it resolves an
// async gate on mount (see WiredHeadphonesNotice/MicPermissionGate's
// "checking" state) — most visibly right after the native splash image
// hides but before the first real screen is ready.
export default function LoadingScreen() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [progress]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * (BAR_WIDTH - KNOB_WIDTH) },
    ],
  }));

  return (
    <View
      className="flex-1 items-center justify-center gap-6"
      style={{ backgroundColor: BACKGROUND_COLOR }}
    >
      <Text
        className="text-4xl font-extrabold uppercase tracking-widest"
        style={{
          color: ACCENT_COLOR,
          textShadowColor: "rgba(255,59,48,0.55)",
          textShadowRadius: 20,
          textShadowOffset: { width: 0, height: 0 },
        }}
      >
        Timing
      </Text>
      <View
        style={{
          width: BAR_WIDTH,
          height: 3,
          borderRadius: 2,
          backgroundColor: "rgba(255,255,255,0.12)",
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={[
            {
              width: KNOB_WIDTH,
              height: 3,
              borderRadius: 2,
              backgroundColor: ACCENT_COLOR,
            },
            knobStyle,
          ]}
        />
      </View>
    </View>
  );
}
