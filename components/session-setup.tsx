import NoteGlyph from "@/components/note-glyph";
import type { Subdivision } from "@/components/sync-recorder";
import type { InputSource } from "@/lib/rhythm-detection";
import { TourTarget } from "@wrack/react-native-tour-guide";
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

const TEMPO_OPTIONS: {
  key: Subdivision;
  label: string;
  disabled?: boolean;
}[] = [
  { key: "quarter", label: "Quarters" },
  { key: "eighth", label: "Eighths" },
  { key: "triplet", label: "Triplets" },
  { key: "sixteenth", label: "Sixteenths" },
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
// (iOS-only shadow blur) — separates the Bars/Tempo sections without a
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
  onChallenges: () => void;
  // Mic (default) vs Tap — see components/tap-recorder.tsx. Selectable here
  // even before microphone access is granted (app/index.tsx's gating
  // condition lets "tap" through regardless); switching back to
  // "microphone" without granted access sends the screen back to
  // MicPermissionGate, which is the correct behavior since that mode
  // actually needs it.
  inputMode: InputSource;
  onInputModeChange: (mode: InputSource) => void;
};

export default function SessionSetup({
  bars,
  onBarsChange,
  subdivision,
  onSubdivisionChange,
  onStart,
  onChallenges,
  inputMode,
  onInputModeChange,
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
      <View className="gap-5">
        <Text className="text-center text-2xl font-extrabold tracking-widest">
          <Text style={{ color: "#FFFFFF" }}>Tim</Text>
          <Text style={{ color: ACCENT_COLOR }}>i</Text>
          <Text style={{ color: "#FFFFFF" }}>ng</Text>
        </Text>

        <View className="flex-row gap-2">
          <View
            className="flex-1 py-3 rounded-xl items-center"
            style={{
              borderWidth: 2,
              borderColor: ACCENT_COLOR,
              backgroundColor: "rgba(255,59,48,0.12)",
            }}
          >
            <Text
              className="text-xs font-bold uppercase tracking-widest"
              style={{ color: ACCENT_COLOR }}
            >
              Training
            </Text>
          </View>
          <Pressable
            onPress={onChallenges}
            className="flex-1 py-3 rounded-xl items-center active:opacity-60"
            style={{
              borderWidth: 2,
              borderColor: "rgba(255,255,255,0.15)",
            }}
          >
            <Text className="text-xs font-bold uppercase tracking-widest text-neutral-400">
              Challenge
            </Text>
          </Pressable>
        </View>

        <TourTarget id="setup-inputmode" style={{ borderRadius: 12 }}>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => onInputModeChange("microphone")}
              className="flex-1 py-2 rounded-xl items-center active:opacity-60"
              style={{
                borderWidth: 2,
                borderColor:
                  inputMode === "microphone" ? ACCENT_COLOR : "rgba(255,255,255,0.15)",
                backgroundColor:
                  inputMode === "microphone" ? "rgba(255,59,48,0.12)" : "transparent",
              }}
            >
              <Text
                className="text-[11px] font-bold uppercase tracking-widest"
                style={{
                  color: inputMode === "microphone" ? ACCENT_COLOR : "#8E8E93",
                }}
              >
                Microphone
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onInputModeChange("tap")}
              className="flex-1 py-2 rounded-xl items-center active:opacity-60"
              style={{
                borderWidth: 2,
                borderColor: inputMode === "tap" ? ACCENT_COLOR : "rgba(255,255,255,0.15)",
                backgroundColor: inputMode === "tap" ? "rgba(255,59,48,0.12)" : "transparent",
              }}
            >
              <Text
                className="text-[11px] font-bold uppercase tracking-widest"
                style={{ color: inputMode === "tap" ? ACCENT_COLOR : "#8E8E93" }}
              >
                Tap
              </Text>
            </Pressable>
          </View>
        </TourTarget>
      </View>

      <View className="flex-1 justify-center gap-6">
        <TourTarget id="setup-bars">
          <View className="items-center gap-2 justify-center" style={{ height: 214 }}>
            <Text
              className="text-[11px] font-bold uppercase tracking-[3px]"
              style={{ color: ACCENT_COLOR }}
            >
              Bars
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
        </TourTarget>

        <GlowDivider />

        <TourTarget id="setup-subdivision">
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
        </TourTarget>
      </View>

      <TourTarget id="setup-start" style={{ borderRadius: 16 }}>
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
            Start
          </Text>
        </Pressable>
      </TourTarget>
    </View>
  );
}
