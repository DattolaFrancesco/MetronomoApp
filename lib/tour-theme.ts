// Shared visual theme for both spotlight tours (see app/index.tsx and
// components/challenge-screen.tsx) — one place to keep them visually
// identical to each other and to the app's own dark/red palette, instead
// of repeating the same overrides at every startTour() call.
import { createTheme } from "@wrack/react-native-tour-guide";

const ACCENT_COLOR = "#FF3B30";

export const tourTheme = createTheme({
  tooltipStyles: {
    backgroundColor: "#1C1C1E",
    borderRadius: 20,
    titleColor: ACCENT_COLOR,
    descriptionColor: "#FFFFFF",
    primaryButtonColor: ACCENT_COLOR,
    secondaryButtonColor: "#3A3A3C",
    buttonTextColor: "#FFFFFF",
    skipButtonColor: "rgba(255,255,255,0.6)",
  },
  spotlightStyles: {
    overlayOpacity: 0.8,
    overlayColor: "#000000",
    enablePulse: true,
    pulseColor: ACCENT_COLOR,
  },
});
