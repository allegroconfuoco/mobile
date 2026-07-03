import { Pressable, StyleSheet } from 'react-native';

import { colors, spacing } from '@/theme';
import { Icon } from '@/components/Icon';

/** Bouton retour aligné en haut à gauche des écrans détail (artiste / album). */
export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={styles.back}
      accessibilityRole="button"
      accessibilityLabel="Retour"
    >
      <Icon name="arrow_back" size={26} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
  },
});

export default BackButton;
