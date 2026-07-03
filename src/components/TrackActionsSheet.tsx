import { Modal, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Menu d'actions sur une piste, présenté en feuille basse (bottom sheet).
 *
 * Ouvert au long-press d'une ligne de bibliothèque. Volontairement minimal : gère la file
 * (« Lire ensuite » / « Ajouter à la file »). Le tap hors de la feuille la referme.
 */
export type TrackActionsSheetProps = {
  /** Titre affiché en en-tête, ou `null` pour garder la feuille fermée. */
  title: string | null;
  onClose: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
};

export function TrackActionsSheet({
  title,
  onClose,
  onPlayNext,
  onAddToQueue,
}: TrackActionsSheetProps) {
  const insets = useSafeAreaInsets();
  const visible = title !== null;

  // Referme la feuille puis exécute l'action, pour éviter un flash de la feuille pendant la mutation.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer le menu">
        {/* Empêche la propagation du tap depuis la feuille vers le fond. */}
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Text style={styles.header} numberOfLines={1}>
            {title}
          </Text>
          <Action icon="playlist_play" label="Lire ensuite" onPress={run(onPlayNext)} />
          <Action icon="playlist_add" label="Ajouter à la file" onPress={run(onAddToQueue)} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Action({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={22} color={colors.accentIcon} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  header: {
    ...typography.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radii.sm,
  },
  actionPressed: {
    backgroundColor: colors.background,
  },
  actionLabel: {
    ...typography.heading,
    fontSize: 15,
  },
});

export default TrackActionsSheet;
