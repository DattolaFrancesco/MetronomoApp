import type { Subdivision } from "@/components/sync-recorder";
import { Canvas, ImageSVG, Skia } from "@shopify/react-native-skia";
import { useMemo } from "react";

// Mirrors the hand-drawn note glyphs in assets/images/{quarti,ottavi,
// terzine,sedicesimi}.svg — inlined here (rather than loaded from the
// asset files at runtime) so recoloring per selection state is just a
// string substitution, with no extra Metro/SVG-transformer setup and no
// new native module (rendered through @shopify/react-native-skia, already
// linked for the report's debug chart). `currentColor` is replaced with
// the actual fill right before parsing.
const NOTE_SVG_TEMPLATES: Record<Subdivision, string> = {
  quarter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <ellipse cx="26" cy="48" rx="10" ry="7.5" fill="currentColor" transform="rotate(-20 26 48)"></ellipse>
    <rect x="33.4" y="10" width="3.2" height="36" rx="1.6" fill="currentColor"></rect>
  </svg>`,
  eighth: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <ellipse cx="16" cy="50" rx="8.5" ry="6.5" fill="currentColor" transform="rotate(-20 16 50)"></ellipse>
    <ellipse cx="44" cy="50" rx="8.5" ry="6.5" fill="currentColor" transform="rotate(-20 44 50)"></ellipse>
    <rect x="22.2" y="14" width="3" height="34" rx="1.5" fill="currentColor"></rect>
    <rect x="50.2" y="14" width="3" height="34" rx="1.5" fill="currentColor"></rect>
    <path d="M22.2 12 L53.2 12 L53.2 19 L22.2 19 Z" fill="currentColor"></path>
  </svg>`,
  triplet: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <ellipse cx="11" cy="52" rx="7.5" ry="5.8" fill="currentColor" transform="rotate(-20 11 52)"></ellipse>
    <ellipse cx="31" cy="52" rx="7.5" ry="5.8" fill="currentColor" transform="rotate(-20 31 52)"></ellipse>
    <ellipse cx="51" cy="52" rx="7.5" ry="5.8" fill="currentColor" transform="rotate(-20 51 52)"></ellipse>
    <rect x="16.6" y="20" width="2.8" height="31" rx="1.4" fill="currentColor"></rect>
    <rect x="36.6" y="20" width="2.8" height="31" rx="1.4" fill="currentColor"></rect>
    <rect x="56.6" y="20" width="2.8" height="31" rx="1.4" fill="currentColor"></rect>
    <path d="M16.6 18 L59.4 18 L59.4 24.5 L16.6 24.5 Z" fill="currentColor"></path>
    <text x="38" y="12" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="bold" font-size="14" fill="currentColor">3</text>
  </svg>`,
  sixteenth: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
    <ellipse cx="16" cy="50" rx="8.5" ry="6.5" fill="currentColor" transform="rotate(-20 16 50)"></ellipse>
    <ellipse cx="44" cy="50" rx="8.5" ry="6.5" fill="currentColor" transform="rotate(-20 44 50)"></ellipse>
    <rect x="22.2" y="12" width="3" height="36" rx="1.5" fill="currentColor"></rect>
    <rect x="50.2" y="12" width="3" height="36" rx="1.5" fill="currentColor"></rect>
    <path d="M22.2 10 L53.2 10 L53.2 16 L22.2 16 Z" fill="currentColor"></path>
    <path d="M22.2 20 L53.2 20 L53.2 26 L22.2 26 Z" fill="currentColor"></path>
  </svg>`,
};

type NoteGlyphProps = {
  subdivision: Subdivision;
  size: number;
  color: string;
};

export default function NoteGlyph({ subdivision, size, color }: NoteGlyphProps) {
  const svg = useMemo(() => {
    const source = NOTE_SVG_TEMPLATES[subdivision].replaceAll("currentColor", color);
    return Skia.SVG.MakeFromString(source);
  }, [subdivision, color]);

  if (!svg) return null;

  return (
    <Canvas style={{ width: size, height: size }}>
      <ImageSVG svg={svg} x={0} y={0} width={size} height={size} />
    </Canvas>
  );
}
