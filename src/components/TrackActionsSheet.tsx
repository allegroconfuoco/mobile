import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { BottomSheet } from '@/components/BottomSheet';

/**
 * Menu d'actions sur une piste, présenté en feuille basse (bottom sheet).
 *
 * Ouvert au long-press d'une ligne de bibliothèque. Volontairement minimal : gère la file
 * (« Lire ensuite » / « Ajouter à la file »). Le tap hors de la feuille la referme.
 */
export type TrackActionsSheetProps = {
  /** Titre affiché en en-tête, ou `null` pour garder la feuille fermée. */
  title: string | null;
  /** La piste est-elle dans les favoris ? (bascule le libellé/l'icône de l'action favori). */
  isFavorite?: boolean;
  onClose: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  /** Bascule l'état favori de la piste. Optionnel : l'action n'apparaît que si fourni. */
  onToggleFavorite?: () => void;
  /** Ouvre le sélecteur de playlist pour y ajouter la piste. */
  onAddToPlaylist: () => void;
  /** Ouvre l'écran de correction des métadonnées (valider / corriger le match MusicBrainz). */
  onFixMetadata: () => void;
  /** Ouvre l'écran de rattachement de ce titre seul à un album (release MusicBrainz). */
  onLinkAlbum: () => void;
  /** Exclut la piste de la bibliothèque (et des scans suivants). */
  onExclude: () => void;
};

export function TrackActionsSheet({
  title,
  isFavorite = false,
  onClose,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  onAddToPlaylist,
  onFixMetadata,
  onLinkAlbum,
  onExclude,
}: TrackActionsSheetProps) {
  const visible = title !== null;

  // Referme la feuille puis exécute l'action, pour éviter un flash de la feuille pendant la mutation.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.header} numberOfLines={1}>
        {title}
      </Text>
      <Action icon="playlist_play" label="Lire ensuite" onPress={run(onPlayNext)} />
      <Action icon="playlist_add" label="Ajouter à la file" onPress={run(onAddToQueue)} />
      {onToggleFavorite && (
        <Action
          icon={isFavorite ? 'favorite' : 'favorite_border'}
          filled={isFavorite}
          label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          onPress={run(onToggleFavorite)}
        />
      )}
      <Action
        icon="playlist_add_check"
        label="Ajouter à une playlist"
        onPress={run(onAddToPlaylist)}
      />
      <Action icon="edit_note" label="Corriger les infos" onPress={run(onFixMetadata)} />
      <Action icon="travel_explore" label="Rattacher à un album" onPress={run(onLinkAlbum)} />
      <Action icon="block" label="Exclure de la bibliothèque" onPress={run(onExclude)} />
    </BottomSheet>
  );
}

function Action({
  icon,
  label,
  onPress,
  filled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  filled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={22} color={colors.accentIcon} filled={filled} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
