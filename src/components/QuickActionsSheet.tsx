import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Feuille basse d'actions génériques, ouverte par un bouton « … » d'en-tête (playlist) ou par le
 * titre de l'écran Lecture. Chaque action referme la feuille avant de s'exécuter.
 */

export type QuickAction = {
  icon: IconName;
  label: string;
  onPress: () => void;
};

export type QuickActionsSheetProps = {
  visible: boolean;
  /** Titre discret en tête de feuille (nom d'album/artiste…), optionnel. */
  title?: string | null;
  actions: QuickAction[];
  onClose: () => void;
};

export function QuickActionsSheet({ visible, title, actions, onClose }: QuickActionsSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={() => {
            onClose();
            action.onPress();
          }}
          android_ripple={{ color: colors.borderStrong }}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Icon name={action.icon} size={22} color={colors.accentIcon} />
          <Text style={styles.rowLabel}>{action.label}</Text>
        </Pressable>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radii.sm,
  },
  rowPressed: {
    backgroundColor: colors.background,
  },
  rowLabel: {
    ...typography.heading,
    fontSize: 15,
  },
});

export default QuickActionsSheet;
