import { TourGuideOverlay, TourGuideProvider } from "@wrack/react-native-tour-guide";
import { Stack } from "expo-router";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "react-native-reanimated";
import "../global.css";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          {/* Both spotlight tours (see app/index.tsx and
              components/challenge-screen.tsx) run through this single
              provider/overlay pair — <TourGuideOverlay /> must be mounted
              exactly once, after all real screen content, for either
              tour's spotlight to actually render. */}
          <TourGuideProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
            </Stack>
            <TourGuideOverlay />
            <StatusBar style="auto" />
          </TourGuideProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
