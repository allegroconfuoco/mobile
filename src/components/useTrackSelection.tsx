import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import { tapLight, tapMedium } from '@/lib/haptics';
import { deleteTracksFromDevice } from '@/library/deleteTrack';
import { useFavorites } from '@/library/FavoritesProvider';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';

/**
 * Mode sélection multiple **mutualisé** entre tous les écrans qui listent des pistes (vue Morceaux,
 * artiste, album, playlist, favoris).
 *
 * Ne rend pas la liste — chaque écran garde son propre rendu (FlatList, SectionList, liste
 * réordonnable…) et se contente de : (1) passer `start` à `useTrackActionsMenu({ onSelect })` pour
 * exposer l'action « Sélectionner », (2) transmettre `active`/`isSelected`/`toggle` à ses lignes
 * (`TrackIndexRow` sait basculer entre lecture et coche), (3) rendre `header` au-dessus de la liste
 * et `footer` en pied quand `active`.
 *
 * `visibleTracks` = les pistes sélectionnables **affichées et ordonnées** de l'écran : sert au « Tout
 * sélectionner » (sur le filtré) et à conserver l'ordre d'affichage dans les actions groupées (« Lire
 * ensuite » sur 10 titres respecte la liste, pas l'ordre des taps).
 *
 * Toutes les actions destructives/favoris passent par les providers globaux (lecteur, favoris,
 * bibliothèque), donc le hook marche depuis n'importe quel écran d'onglet.
 */
export type TrackSelection = {
  /** Mode sélection actif. */
  active: boolean;
  /** La piste est-elle cochée ? */
  isSelected: (id: string) => boolean;
  /** Bascule la coche d'une piste (tap en mode sélection). */
  toggle: (track: LocalTrack) => void;
  /** Entre en sélection avec une piste pré-cochée (à passer à `useTrackActionsMenu.onSelect`). */
  start: (track: LocalTrack) => void;
  /** Sort du mode sélection. */
  cancel: () => void;
  /** Barre supérieure (compteur + Tout/Aucun + Annuler), à rendre au-dessus de la liste. */
  header: ReactNode;
  /** Barre d'actions groupées, à rendre en pied de liste. */
  footer: ReactNode;
};

export function useTrackSelection(
  visibleTracks: LocalTrack[],
  options?: {
    /**
     * Ouvre le sélecteur « Ajouter à une playlist » avec les pistes cochées. La feuille vit dans
     * l'écran (état local) ; il branche `onAdded={cancel}` pour ne sortir du mode qu'après un ajout
     * réussi (pas sur simple fermeture). Sans callback, l'action Playlist est masquée.
     */
    onAddToPlaylist?: (tracks: LocalTrack[]) => void;
  }
): TrackSelection {
  const onAddToPlaylist = options?.onAddToPlaylist;
  const { playNext, addToQueue } = usePlayer();
  const { addFavorites } = useFavorites();
  const { setTracksExcluded, reloadTracks } = useLibrary();

  // `null` = mode normal ; un `Set` (même vide) = mode sélection.
  const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
  const active = selection !== null;

  const isSelected = useCallback((id: string) => selection?.has(id) ?? false, [selection]);

  const toggle = useCallback((track: LocalTrack) => {
    setSelection((prev) => {
      if (!prev) {
        return prev;
      }
      const next = new Set(prev);
      if (next.has(track.id)) {
        next.delete(track.id);
      } else {
        next.add(track.id);
      }
      return next;
    });
  }, []);

  const start = useCallback((track: LocalTrack) => setSelection(new Set([track.id])), []);
  const cancel = useCallback(() => setSelection(null), []);

  // Pistes cochées dans l'ordre d'affichage courant (pas l'ordre des taps).
  const selectedTracks = selection ? visibleTracks.filter((t) => selection.has(t.id)) : [];
  const count = selectedTracks.length;

  // « Tout » porte sur la liste affichée (donc filtrée) ; re-tap = tout désélectionner.
  const allVisibleSelected =
    active && visibleTracks.length > 0 && visibleTracks.every((t) => selection!.has(t.id));
  const toggleAllVisible = () => {
    setSelection((prev) => {
      if (!prev) {
        return prev;
      }
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const t of visibleTracks) {
          next.delete(t.id);
        }
      } else {
        for (const t of visibleTracks) {
          next.add(t.id);
        }
      }
      return next;
    });
  };

  const addSelectedToPlaylist = () => {
    if (count === 0 || !onAddToPlaylist) {
      return;
    }
    // Ne sort PAS du mode ici : l'écran appellera `cancel` via `onAdded` du sélecteur (après succès).
    onAddToPlaylist(selectedTracks);
  };

  const playNextSelected = () => {
    if (count === 0) {
      return;
    }
    tapLight();
    void playNext(selectedTracks);
    showToast(count > 1 ? `${count} titres liront ensuite` : 'Lira ensuite', 'queue_music');
    setSelection(null);
  };

  const addSelectedToQueue = () => {
    if (count === 0) {
      return;
    }
    tapLight();
    void addToQueue(selectedTracks);
    showToast(count > 1 ? `${count} titres ajoutés à la file` : 'Ajouté à la file', 'queue_music');
    setSelection(null);
  };

  const addSelectedToFavorites = () => {
    if (count === 0) {
      return;
    }
    tapLight();
    // « Ajouter » ne re-like pas ce qui l'est déjà : le message reflète le nombre réellement ajouté.
    const added = addFavorites(selectedTracks.map((t) => ({ id: t.id, mbid: t.mbid })));
    showToast(
      added === 0
        ? 'Déjà dans les favoris'
        : added > 1
          ? `${added} titres ajoutés aux favoris`
          : 'Ajouté aux favoris',
      'favorite'
    );
    setSelection(null);
  };

  const excludeSelected = () => {
    if (count === 0) {
      return;
    }
    tapMedium();
    setTracksExcluded(
      selectedTracks.map((t) => t.id),
      true
    );
    showToast(count > 1 ? `${count} titres exclus de la bibliothèque` : 'Piste exclue', 'block');
    setSelection(null);
  };

  const deleteSelectedFromDevice = () => {
    if (count === 0) {
      return;
    }
    const toDelete = selectedTracks;
    const n = toDelete.length;
    Alert.alert(
      n > 1 ? `Supprimer ${n} titres du téléphone ?` : 'Supprimer du téléphone ?',
      n > 1
        ? `${n} fichiers seront définitivement supprimés de l’appareil.`
        : `« ${toDelete[0].title} » sera définitivement supprimé de l’appareil.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () =>
            void deleteTracksFromDevice(toDelete).then((deleted) => {
              if (deleted) {
                tapMedium();
                reloadTracks();
                showToast(
                  n > 1 ? `${n} fichiers supprimés du téléphone` : 'Fichier supprimé du téléphone',
                  'delete'
                );
                setSelection(null);
              } else {
                showToast('Suppression annulée ou refusée', 'block');
              }
            }),
        },
      ]
    );
  };

  const header = active ? (
    <View style={styles.selectionBar}>
      <Text style={styles.selectionCount}>
        {count} sélectionné{count > 1 ? 's' : ''}
      </Text>
      <Pressable
        onPress={toggleAllVisible}
        hitSlop={8}
        style={styles.selectionAction}
        accessibilityRole="button"
      >
        <Text style={styles.selectionActionLabel}>{allVisibleSelected ? 'Aucun' : 'Tout'}</Text>
      </Pressable>
      <Pressable
        onPress={cancel}
        hitSlop={8}
        style={styles.selectionAction}
        accessibilityRole="button"
      >
        <Text style={styles.selectionActionLabel}>Annuler</Text>
      </Pressable>
    </View>
  ) : null;

  const footer = active ? (
    <View style={styles.selectionFooter}>
      {onAddToPlaylist && (
        <SelectionFooterAction
          icon="playlist_add_check"
          label="Playlist"
          disabled={count === 0}
          onPress={addSelectedToPlaylist}
        />
      )}
      <SelectionFooterAction
        icon="playlist_play"
        label="Lire ensuite"
        disabled={count === 0}
        onPress={playNextSelected}
      />
      <SelectionFooterAction
        icon="playlist_add"
        label="File"
        disabled={count === 0}
        onPress={addSelectedToQueue}
      />
      <SelectionFooterAction
        icon="favorite"
        label="Favoris"
        disabled={count === 0}
        onPress={addSelectedToFavorites}
      />
      <SelectionFooterAction
        icon="block"
        label="Exclure"
        disabled={count === 0}
        onPress={excludeSelected}
      />
      <SelectionFooterAction
        icon="delete"
        label="Supprimer"
        disabled={count === 0}
        onPress={deleteSelectedFromDevice}
        destructive
      />
    </View>
  ) : null;

  return { active, isSelected, toggle, start, cancel, header, footer };
}

/** Action de la barre du mode sélection (icône + libellé court, désactivée si sélection vide). */
function SelectionFooterAction({
  icon,
  label,
  disabled,
  onPress,
  destructive = false,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onPress: () => void;
  /** Teinte l'action en accent « danger » (suppression physique). */
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.selectionFooterAction,
        pressed && styles.footerPressed,
        disabled && styles.selectionFooterDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Icon name={icon} size={21} color={destructive ? colors.danger : colors.accentIcon} />
      <Text
        style={[styles.selectionFooterLabel, destructive && styles.selectionFooterLabelDanger]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  selectionCount: {
    ...typography.heading,
    fontSize: 14,
    flex: 1,
  },
  selectionAction: {
    paddingVertical: spacing.xs,
  },
  selectionActionLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 13,
    color: colors.accentLabel,
  },
  selectionFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  selectionFooterAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: 2,
  },
  footerPressed: {
    backgroundColor: colors.background,
  },
  selectionFooterDisabled: {
    opacity: 0.4,
  },
  selectionFooterLabel: {
    ...typography.body,
    fontSize: 10.5,
    color: colors.textSecondary,
  },
  selectionFooterLabelDanger: {
    color: colors.danger,
  },
});
