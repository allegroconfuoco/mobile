import { Pressable, StyleSheet } from 'react-native';

import { colors, spacing } from '@/theme';
import { Icon } from '@/components/Icon';
import { openDrawer } from '@/lib/drawer';
import { tapLight } from '@/lib/haptics';

/**
 * Bouton hamburger : ouvre le menu latéral. Aligné comme `BackButton` (même gabarit de zone
 * tactile) pour que les en-têtes des écrans de premier niveau et de détail restent cohérents —
 * l'un a un retour, l'autre le menu, à la même place.
 */
export function MenuButton() {
  return (
    <Pressable
      onPress={() => {
        tapLight();
        openDrawer();
      }}
      hitSlop={12}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir le menu"
    >
      <Icon name="menu" size={26} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
  },
});

export default MenuButton;
