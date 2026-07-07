import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, spacing, typography } from '@/theme';

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

/**
 * Sélecteur de vue « Forge » : à plat, labels en majuscules, liseré accent **glissant** sous
 * l'option active (motion design, API Animated du cœur RN). On mesure la position/largeur de
 * chaque option (`onLayout`) puis on anime l'indicateur vers l'option sélectionnée. Défilable
 * horizontalement pour absorber un nombre variable d'options sans clipper.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  // Positions mesurées de chaque option (x + largeur) dans la zone défilante.
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const [translateX] = useState(() => new Animated.Value(0));
  const [width] = useState(() => new Animated.Value(0));
  // La première mise en place se fait sans animation (pas de « saut » depuis 0 au montage).
  const animatedOnce = useRef(false);

  const moveTo = useCallback(
    (key: string, animate: boolean) => {
      const layout = layouts.current[key];
      if (!layout) {
        return;
      }
      if (animate) {
        // useNativeDriver:false car on anime la largeur (propriété de layout).
        Animated.parallel([
          Animated.spring(translateX, {
            toValue: layout.x,
            useNativeDriver: false,
            speed: 20,
            bounciness: 2,
          }),
          Animated.spring(width, {
            toValue: layout.width,
            useNativeDriver: false,
            speed: 20,
            bounciness: 2,
          }),
        ]).start();
      } else {
        translateX.setValue(layout.x);
        width.setValue(layout.width);
      }
    },
    [translateX, width]
  );

  useEffect(() => {
    moveTo(value, animatedOnce.current);
    animatedOnce.current = true;
  }, [value, moveTo]);

  const onItemLayout = (key: string, e: LayoutChangeEvent) => {
    const { x, width: w } = e.nativeEvent.layout;
    layouts.current[key] = { x, width: w };
    // Positionne l'indicateur dès que l'option active est mesurée (sans animation).
    if (key === value) {
      moveTo(value, false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {segments.map((seg) => {
          const active = seg.value === value;
          return (
            <Pressable
              key={seg.value}
              onLayout={(e) => onItemLayout(seg.value, e)}
              onPress={() => onChange(seg.value)}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={seg.label}
            >
              <Text style={[styles.label, active && styles.labelActive]}>{seg.label}</Text>
            </Pressable>
          );
        })}
        <Animated.View style={[styles.indicator, { width, transform: [{ translateX }] }]} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xxl,
    gap: spacing.xl,
  },
  item: {
    paddingBottom: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.textPrimary,
  },
  // Liseré actif glissant : posé au bas de la zone défilante, positionné/dimensionné par animation.
  indicator: {
    position: 'absolute',
    left: 0,
    bottom: -1,
    height: 2,
    backgroundColor: colors.accent,
  },
});

export default SegmentedControl;
