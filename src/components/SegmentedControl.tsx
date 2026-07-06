import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
 * Sélecteur de vue « Forge » : à plat, labels en majuscules, liseré accent sous l'option active
 * (même langage visuel que la tab bar). Défilable horizontalement pour absorber un nombre variable
 * d'options (Morceaux / Artistes / Albums / Playlists) sans clipper sur les écrans étroits ; le
 * liseré bas reste pleine largeur (porté par le conteneur, pas par la zone défilante).
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: SegmentedControlProps<T>) {
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
              onPress={() => onChange(seg.value)}
              style={[styles.item, active && styles.itemActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={seg.label}
            >
              <Text style={[styles.label, active && styles.labelActive]}>{seg.label}</Text>
            </Pressable>
          );
        })}
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
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    // Fait chevaucher le liseré actif (2px) sur celui du conteneur (1px), comme avant.
    marginBottom: -1,
  },
  itemActive: {
    borderBottomColor: colors.accent,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.textPrimary,
  },
});

export default SegmentedControl;
