import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Feuille basse d'actions génériques (lot 11 de l'audit) : remplace les rangées d'icônes
 * accumulées dans les en-têtes d'écran (album, artiste) par un unique bouton « … » qui ouvre
 * cette liste. Chaque action referme la feuille avant de s'exécuter (navigation le plus souvent).
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
    <BottomSheet visible={visible} onClose={onClose}>
      {title ? (
        <Text style={styles.header} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
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
          {/* Mêmes couleur d'icône et hauteur de ligne que TrackActionsSheet : les deux feuilles
              doivent être indiscernables à l'œil (passe UX), seules leurs APIs diffèrent. */}
          <Icon name={action.icon} size={22} color={colors.accentIcon} />
          <Text style={styles.rowLabel}>{action.label}</Text>
        </Pressable>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    ...typography.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
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
