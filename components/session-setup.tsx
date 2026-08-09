import type { Subdivision } from "@/components/sync-recorder";
import { MaterialCommunityIcons } from "@expo/vector-icons";
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

const ACTIVE_COLOR = "#39FF6A";
const ITEM_WIDTH_RATIO = 0.42;

const BARS_OPTIONS = [1, 2, 3, 4] as const;

type NoteIconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

// Only "sixteenth" is still not wired to the real detection engine (see
// sync-recorder.tsx/beat-indicator.tsx) — stays visible but disabled until
// validated on-device, so there's nothing left to build here when we
// unlock it (just remove `disabled`).
const TEMPO_OPTIONS: {
  key: Subdivision;
  label: string;
  icon: NoteIconName;
  badge?: string;
  disabled?: boolean;
}[] = [
  { key: "quarter", label: "Quarti", icon: "music-note-quarter" },
  { key: "eighth", label: "Ottavi", icon: "music-note-eighth" },
  { key: "triplet", label: "Terzine", icon: "music-note-eighth", badge: "3" },
  { key: "sixteenth", label: "Quartine", icon: "music-note-sixteenth", disabled: true },
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
              outputRange: [0.72, 1, 0.72],
              extrapolate: "clamp",
            });
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.3, 1, 0.3],
              extrapolate: "clamp",
            });
            return (
              <View key={i} style={{ width: itemWidth, alignItems: "center", justifyContent: "center" }}>
                <Animated.View style={{ transform: [{ scale }], opacity }}>
                  {renderItem(item, i === selectedIndex, disabledIndices.includes(i))}
                </Animated.View>
              </View>
            );
          })}
        </Animated.ScrollView>
      )}

      <View className="flex-row justify-center items-center gap-1.5 mt-3">
        {items.map((_, i) => (
          <View
            key={i}
            style={{
              width: i === selectedIndex ? 16 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor:
                i === selectedIndex ? ACTIVE_COLOR : "rgba(255,255,255,0.25)",
            }}
          />
        ))}
      </View>
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
        <Text className="text-white/50 text-[11px] font-bold uppercase tracking-[3px]">
          Setup
        </Text>
        <Text className="text-white/50 text-[11px] font-bold uppercase tracking-[3px]">
          Tempo
        </Text>
      </View>

      <View className="flex-1 justify-center gap-7">
        <View className="items-center gap-1.5 h-36 justify-center">
          <Text className="text-white/35 text-[10px] font-semibold uppercase tracking-widest">
            Battute
          </Text>
          <Carousel
            items={BARS_OPTIONS}
            selectedIndex={barsIndex}
            onSelect={(i) => onBarsChange(BARS_OPTIONS[i])}
            renderItem={(n, selected) => (
              <Text
                style={{
                  fontSize: 56,
                  fontWeight: "800",
                  color: selected ? "#FFFFFF" : "rgba(255,255,255,0.5)",
                }}
              >
                {n}
              </Text>
            )}
          />
        </View>

        <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.15)" }} />

        <View className="items-center gap-1.5 h-36 justify-center">
          <Text className="text-white/35 text-[10px] font-semibold uppercase tracking-widest">
            Suddivisione
          </Text>
          <Carousel
            items={TEMPO_OPTIONS}
            selectedIndex={subdivisionIndex}
            disabledIndices={disabledTempoIndices}
            onSelect={(i) => onSubdivisionChange(TEMPO_OPTIONS[i].key)}
            renderItem={(opt, selected, disabled) => (
              <View className="items-center gap-1.5" style={{ opacity: disabled ? 0.35 : 1 }}>
                <View>
                  <MaterialCommunityIcons
                    name={opt.icon}
                    size={42}
                    color={selected ? ACTIVE_COLOR : "rgba(255,255,255,0.55)"}
                  />
                  {opt.badge && (
                    <View
                      className="absolute items-center justify-center"
                      style={{
                        top: -4,
                        right: -9,
                        minWidth: 15,
                        height: 15,
                        borderRadius: 8,
                        paddingHorizontal: 3,
                        backgroundColor: selected ? ACTIVE_COLOR : "rgba(255,255,255,0.55)",
                      }}
                    >
                      <Text style={{ fontSize: 9, fontWeight: "800", color: "#071615" }}>
                        {opt.badge}
                      </Text>
                    </View>
                  )}
                </View>
                <Text
                  className="text-[10px] font-semibold"
                  style={{ color: selected ? ACTIVE_COLOR : "rgba(255,255,255,0.45)" }}
                >
                  {opt.label}
                </Text>
              </View>
            )}
          />
        </View>

        <View className="flex-row items-center justify-center gap-2">
          <Text className="text-white/30 text-xs">←</Text>
          <Text className="text-white/30 text-[10px] font-bold uppercase tracking-[2px]">
            Scorri per cambiare
          </Text>
          <Text className="text-white/30 text-xs">→</Text>
        </View>
      </View>

      <Pressable
        onPress={onStart}
        className="self-stretch py-5 rounded-xl items-center active:opacity-85 bg-white"
      >
        <Text className="text-black text-xl font-bold">Inizia</Text>
      </Pressable>
    </View>
  );
}
