import NoteGlyph from "@/components/note-glyph";
import type { Subdivision } from "@/components/sync-recorder";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

const ACCENT_COLOR = "#FF3B30";
const DIM_COLOR = "rgba(255,255,255,0.3)";
const ITEM_WIDTH_RATIO = 0.32;

const BARS_OPTIONS = [1, 2, 3, 4] as const;

// Only "sixteenth" is still not wired to the real detection engine (see
// sync-recorder.tsx/beat-indicator.tsx) — stays visible but disabled until
// validated on-device, so there's nothing left to build here when we
// unlock it (just remove `disabled`).
const TEMPO_OPTIONS: {
  key: Subdivision;
  label: string;
  disabled?: boolean;
}[] = [
  { key: "quarter", label: "Quarti" },
  { key: "eighth", label: "Ottavi" },
  { key: "triplet", label: "Terzine" },
  { key: "sixteenth", label: "Quartine", disabled: true },
];

type CarouselProps<T> = {
  items: readonly T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  disabledIndices?: number[];
  renderItem: (item: T, selected: boolean, disabled: boolean) => React.ReactNode;
};

function Carousel<T>({
  items,
  selectedIndex,
  onSelect,
  disabledIndices = [],
  renderItem,
}: CarouselProps<T>) {
  const [columnWidth, setColumnWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX] = useState(() => new Animated.Value(0));

  const itemWidth = columnWidth * ITEM_WIDTH_RATIO;
  const sidePadding = (columnWidth - itemWidth) / 2;

  useEffect(() => {
    if (columnWidth > 0) {
      scrollRef.current?.scrollTo({ x: selectedIndex * itemWidth, animated: false });
    }
    // Only re-center when the column is (re)measured, not on every
    // selectedIndex change — the carousel's own scroll gesture is what
    // drives selectedIndex during normal use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnWidth]);

  const handleMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (itemWidth === 0) return;
    const rawIndex = Math.round(e.nativeEvent.contentOffset.x / itemWidth);
    const index = Math.max(0, Math.min(items.length - 1, rawIndex));

    if (disabledIndices.includes(index)) {
      scrollRef.current?.scrollTo({ x: selectedIndex * itemWidth, animated: true });
      return;
    }
    if (index !== selectedIndex) {
      onSelect(index);
    }
  };

  // Tapping any item (the centered one or a peeking neighbor) snaps the
  // carousel straight to it — same disabled-bounce-back and onSelect path
  // as finishing a swipe there, just skipping the drag.
  const handlePressItem = (index: number) => {
    if (itemWidth === 0) return;
    scrollRef.current?.scrollTo({ x: index * itemWidth, animated: true });
  };

  return (
    <View
      className="w-full"
      onLayout={(e) => setColumnWidth(e.nativeEvent.layout.width)}
    >
      {columnWidth > 0 && (
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={itemWidth}
          contentContainerStyle={{ paddingHorizontal: sidePadding }}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: true },
          )}
          onMomentumScrollEnd={handleMomentumScrollEnd}
        >
          {items.map((item, i) => {
            const inputRange = [(i - 1) * itemWidth, i * itemWidth, (i + 1) * itemWidth];
            const scale = scrollX.interpolate({
              inputRange,
              outputRange: [0.62, 1, 0.62],
              extrapolate: "clamp",
            });
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.4, 1, 0.4],
              extrapolate: "clamp",
            });
            return (
              <Pressable
                key={i}
                onPress={() => handlePressItem(i)}
                style={{ width: itemWidth, alignItems: "center", justifyContent: "center" }}
              >
                <Animated.View style={{ transform: [{ scale }], opacity }}>
                  {renderItem(item, i === selectedIndex, disabledIndices.includes(i))}
                </Animated.View>
              </Pressable>
            );
          })}
        </Animated.ScrollView>
      )}

      <View className="flex-row justify-center items-center gap-1.5 mt-3">
        {items.map((_, i) => {
          const active = i === selectedIndex;
          return (
            <View
              key={i}
              style={{
                width: active ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: active ? ACCENT_COLOR : "rgba(255,255,255,0.25)",
                ...(active
                  ? {
                      shadowColor: ACCENT_COLOR,
                      shadowOpacity: 0.8,
                      shadowRadius: 5,
                      shadowOffset: { width: 0, height: 0 },
                    }
                  : null),
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

// Thin horizontal line fading out at both ends, with a soft red bloom
// (iOS-only shadow blur) — separates the Battute/Tempo sections without a
// hard, flat divider.
export function GlowDivider() {
  return (
    <View className="items-center justify-center" style={{ height: 20 }}>
      <LinearGradient
        colors={["transparent", ACCENT_COLOR, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          height: 2,
          width: "70%",
          borderRadius: 1,
          shadowColor: ACCENT_COLOR,
          shadowOpacity: 0.9,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
    </View>
  );
}

type SessionSetupProps = {
  bars: number;
  onBarsChange: (bars: number) => void;
  subdivision: Subdivision;
  onSubdivisionChange: (subdivision: Subdivision) => void;
  onStart: () => void;
};

export default function SessionSetup({
  bars,
  onBarsChange,
  subdivision,
  onSubdivisionChange,
  onStart,
}: SessionSetupProps) {
  const barsIndex = Math.max(0, BARS_OPTIONS.indexOf(bars as (typeof BARS_OPTIONS)[number]));
  const subdivisionIndex = Math.max(
    0,
    TEMPO_OPTIONS.findIndex((o) => o.key === subdivision),
  );
  const disabledTempoIndices = useMemo(
    () =>
      TEMPO_OPTIONS.reduce<number[]>((acc, o, i) => {
        if (o.disabled) acc.push(i);
        return acc;
      }, []),
    [],
  );

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between">
        <Text className="text-white text-lg font-extrabold tracking-widest">
          Tempo
        </Text>
        <Text
          className="text-[11px] font-bold uppercase tracking-[3px]"
          style={{ color: ACCENT_COLOR }}
        >
          Setup
        </Text>
      </View>

      <View className="flex-1 justify-center gap-6">
        <View className="items-center gap-2 justify-center" style={{ height: 214 }}>
          <Text
            className="text-[11px] font-bold uppercase tracking-[3px]"
            style={{ color: ACCENT_COLOR }}
          >
            Battute
          </Text>
          <Carousel
            items={BARS_OPTIONS}
            selectedIndex={barsIndex}
            onSelect={(i) => onBarsChange(BARS_OPTIONS[i])}
            renderItem={(n, selected) => (
              <Text
                style={{
                  fontSize: 112,
                  lineHeight: 120,
                  fontWeight: "800",
                  color: selected ? "#FFFFFF" : DIM_COLOR,
                  ...(selected
                    ? {
                        textShadowColor: "rgba(255,59,48,0.55)",
                        textShadowRadius: 20,
                        textShadowOffset: { width: 0, height: 0 },
                      }
                    : null),
                }}
              >
                {n}
              </Text>
            )}
          />
        </View>

        <GlowDivider />

        <View className="items-center gap-2 justify-center" style={{ height: 214 }}>
          <Text
            className="text-[11px] font-bold uppercase tracking-[3px]"
            style={{ color: ACCENT_COLOR }}
          >
            Tempo
          </Text>
          <Carousel
            items={TEMPO_OPTIONS}
            selectedIndex={subdivisionIndex}
            disabledIndices={disabledTempoIndices}
            onSelect={(i) => onSubdivisionChange(TEMPO_OPTIONS[i].key)}
            renderItem={(opt, selected, disabled) => (
              <View
                style={{
                  opacity: disabled ? 0.35 : 1,
                  ...(selected
                    ? {
                        shadowColor: ACCENT_COLOR,
                        shadowOpacity: 0.55,
                        shadowRadius: 16,
                        shadowOffset: { width: 0, height: 0 },
                      }
                    : null),
                }}
              >
                <NoteGlyph
                  subdivision={opt.key}
                  size={92}
                  color={selected ? "#FFFFFF" : DIM_COLOR}
                />
              </View>
            )}
          />
        </View>
      </View>

      <Pressable
        onPress={onStart}
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
          Inizia
        </Text>
      </Pressable>
    </View>
  );
}
