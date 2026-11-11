import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { colors, spacing, typography } from '@/theme';
import { selection as hapticSelection } from '@/lib/haptics';
import { SPRING_SNAPPY, useSpringFlag } from '@/lib/motion';

/** Une option du sélecteur. */
export type Segment<T extends string> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
};

type Box = { x: number; width: number };

/**
 * Sélecteur de vue : à plat, labels en majuscules, liseré accent qui **glisse** sous l'option
 * active. On mesure la position et la largeur de chaque option, puis le liseré s'y rend sur un
 * ressort, calculé sur le thread d'interface.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  // Boîtes mesurées de chaque option, indexées comme `segments`. Valeur partagée : le liseré se
  // place sur le thread d'interface dès que la mesure arrive, sans re-rendu.
  const boxes = useSharedValue<Box[]>([]);
  const index = segments.findIndex((s) => s.value === value);
  const active = useSharedValue(index);
  // Faux tant que le liseré n'a pas été posé une première fois : la pose initiale est immédiate.
  const placed = useSharedValue(false);

  useEffect(() => {
    active.set(index);
  }, [index, active]);

  const onItemLayout = (i: number, e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    boxes.modify((current) => {
      'worklet';
      current[i] = { x, width };
      return current;
    });
  };

  const indicatorStyle = useAnimatedStyle(() => {
    const box = boxes.get()[active.get()];
    if (!box) {
      return { opacity: 0 };
    }
    if (!placed.get()) {
      placed.set(true);
      return { opacity: 1, width: box.width, transform: [{ translateX: box.x }] };
    }
    return {
      opacity: 1,
      width: withSpring(box.width, SPRING_SNAPPY),
      transform: [{ translateX: withSpring(box.x, SPRING_SNAPPY) }],
    };
  });

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {segments.map((segment, i) => (
          <SegmentItem
            key={segment.value}
            label={segment.label}
            active={segment.value === value}
            onLayout={(e) => onItemLayout(i, e)}
            onPress={() => {
              if (segment.value !== value) {
                hapticSelection();
                onChange(segment.value);
              }
            }}
          />
        ))}
        <Animated.View style={[styles.indicator, indicatorStyle]} pointerEvents="none" />
      </View>
    </View>
  );
}

function SegmentItem({
  label,
  active,
  onLayout,
  onPress,
}: {
  label: string;
  active: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  onPress: () => void;
}) {
  const on = useSpringFlag(active);
  const activeStyle = useAnimatedStyle(() => ({ opacity: on.get() }));
  return (
    <Pressable
      onLayout={onLayout}
      onPress={onPress}
      hitSlop={6}
      style={styles.item}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      {/* Deux libellés superposés fondus l'un dans l'autre (cf. TabBar). */}
      <Text style={styles.label}>{label}</Text>
      <Animated.View style={[styles.activeLayer, activeStyle]}>
        <Text style={[styles.label, styles.labelActive]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingHorizontal: spacing.xxl,
  },
  item: {
    paddingVertical: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
  },
  activeLayer: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
  },
  labelActive: {
    color: colors.textPrimary,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    bottom: -1,
    height: 2,
    backgroundColor: colors.accent,
  },
});

export default SegmentedControl;
