import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { BottomSheet } from '@/components/BottomSheet';

/**
 * Menu d'actions sur une piste, présenté en feuille basse (bottom sheet).
 *
 * Ouvert au long-press d'une ligne de bibliothèque. Le tap hors de la feuille la referme.
 *
 * Segmenté en deux pages (passe UX) : les actions **du quotidien** (file, favori, playlist,
 * sélection) d'abord, puis une entrée unique « Métadonnées… » qui bascule le contenu de la feuille
 * vers les flux power-user (corriger, rattacher, artistes, gravure) — ils restent à un tap, sans
 * noyer la liste principale sous ~10 actions à plat.
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
  /**
   * Entre en mode sélection multiple avec cette piste pré-cochée. Optionnel : seuls les écrans
   * qui portent un mode sélection (vue Morceaux) fournissent ce handler.
   */
  onSelect?: () => void;
  /** Ouvre l'écran de correction des métadonnées (valider / corriger le match MusicBrainz). */
  onFixMetadata: () => void;
  /** Ouvre l'écran de rattachement de ce titre seul à un album (release MusicBrainz). */
  onLinkAlbum: () => void;
  /** Ouvre l'écran de suppression d'artiste(s) pour ce titre. Optionnel : n'apparaît que si fourni. */
  onEditArtists?: () => void;
  /**
   * Grave les infos corrigées dans le fichier MP3 (write-back ID3). Optionnel : l'action n'apparaît
   * que si fourni.
   */
  onWriteToFile?: () => void;
  /**
   * Restaure les tags d'origine du fichier (sauvegardés avant la première gravure). Optionnel :
   * l'action n'apparaît que si fourni **et** qu'une sauvegarde existe (`hasFileBackup`).
   */
  onRestoreFile?: () => void;
  /** Une sauvegarde des tags d'origine existe pour cette piste (conditionne l'action « restaurer »). */
  hasFileBackup?: boolean;
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
  onSelect,
  onFixMetadata,
  onLinkAlbum,
  onEditArtists,
  onWriteToFile,
  onRestoreFile,
  hasFileBackup = false,
  onExclude,
}: TrackActionsSheetProps) {
  const visible = title !== null;

  // Page affichée : actions du quotidien, ou sous-page métadonnées. Réinitialisée à chaque
  // ouverture (motif « ajuster l'état pendant le rendu », pas d'effet).
  const [page, setPage] = useState<'main' | 'metadata'>('main');
  const [syncedTitle, setSyncedTitle] = useState(title);
  if (title !== syncedTitle) {
    setSyncedTitle(title);
    setPage('main');
  }

  // Referme la feuille puis exécute l'action, pour éviter un flash de la feuille pendant la mutation.
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {page === 'main' ? (
        <>
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
          {onSelect && <Action icon="checklist" label="Sélectionner" onPress={run(onSelect)} />}

          <View style={styles.divider} />
          {/* Bascule de page, ne referme pas la feuille. */}
          <Action
            icon="edit_note"
            label="Métadonnées…"
            trailing="chevron_right"
            onPress={() => setPage('metadata')}
          />

          <View style={styles.divider} />
          <Action icon="block" label="Exclure de la bibliothèque" onPress={run(onExclude)} />
        </>
      ) : (
        <>
          {/* Retour vers les actions du quotidien, même piste. */}
          <Pressable
            onPress={() => setPage('main')}
            style={({ pressed }) => [styles.backRow, pressed && styles.actionPressed]}
            accessibilityRole="button"
            accessibilityLabel="Retour aux actions"
          >
            <Icon name="arrow_back" size={20} color={colors.textSecondary} />
            <Text style={styles.backLabel} numberOfLines={1}>
              {title}
            </Text>
          </Pressable>
          <Action icon="edit_note" label="Corriger les infos" onPress={run(onFixMetadata)} />
          <Action icon="travel_explore" label="Rattacher à un album" onPress={run(onLinkAlbum)} />
          {onEditArtists && (
            <Action icon="group" label="Modifier les artistes" onPress={run(onEditArtists)} />
          )}
          {onWriteToFile && (
            <Action icon="save" label="Écrire dans le fichier" onPress={run(onWriteToFile)} />
          )}
          {onRestoreFile && hasFileBackup && (
            <Action
              icon="settings_backup_restore"
              label="Restaurer les tags d’origine"
              onPress={run(onRestoreFile)}
            />
          )}
        </>
      )}
    </BottomSheet>
  );
}

function Action({
  icon,
  label,
  onPress,
  filled = false,
  trailing,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  filled?: boolean;
  /** Icône de fin de ligne (ex. chevron d'une sous-page). */
  trailing?: IconName;
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
      {trailing && <Icon name={trailing} size={20} color={colors.textMuted} />}
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
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
    marginHorizontal: spacing.lg,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderRadius: radii.sm,
  },
  backLabel: {
    ...typography.label,
    color: colors.textMuted,
    flex: 1,
  },
});

export default TrackActionsSheet;
