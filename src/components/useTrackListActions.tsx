import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, BackHandler, Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { showToast } from '@/components/Toast';
import { tapLight, tapMedium } from '@/lib/haptics';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { deleteTracksFromDevice } from '@/library/deleteTrack';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';

/**
 * Tout ce qu'on peut faire sur les lignes d'une liste de pistes, mutualisé entre les écrans
 * (Morceaux, artiste, album, playlist, favoris, recherche).
 *
 * Trois gestes, du plus fréquent au plus rare :
 *  - **« + »** à droite de la ligne : ouvre la feuille « Ajouter à » pour ce titre ;
 *  - **glissement vers la droite** : « Lire ensuite » ;
 *  - **appui long** : entre en sélection multiple, la ligne étant déjà cochée. La barre du bas
 *    porte alors les actions groupées, qui valent aussi pour un seul titre — il n'y a donc plus de
 *    menu d'actions séparé.
 *
 * Le hook ne rend pas la liste : chaque écran garde son rendu (FlatList, SectionList, liste
 * réordonnable) et se contente de passer `selection.active` / `isSelected` / `toggle` à ses
 * lignes, de rendre `selection.header` au-dessus, `selection.footer` en pied, et `element` une
 * fois dans son arbre.
 *
 * `visibleTracks` = les pistes **affichées et ordonnées** de l'écran : sert au « Tout » et à
 * conserver l'ordre d'affichage dans les actions groupées (« Lire ensuite » sur dix titres
 * respecte la liste, pas l'ordre des taps).
 */
export type TrackSelection = {
  /** Mode sélection actif. */
  active: boolean;
  /** La piste est-elle cochée ? */
  isSelected: (id: string) => boolean;
  /** Bascule la coche d'une piste (tap en mode sélection). */
  toggle: (track: LocalTrack) => void;
  /** Entre en sélection avec une piste pré-cochée (appui long). */
  start: (track: LocalTrack) => void;
  /** Sort du mode sélection. */
  cancel: () => void;
  /** Barre supérieure (compteur + Tout/Aucun + Annuler), à rendre au-dessus de la liste. */
  header: ReactNode;
  /** Barre d'actions groupées, à rendre en pied de liste. */
  footer: ReactNode;
};

export type TrackListActions = {
  selection: TrackSelection;
  /** « + » d'une ligne : ouvre « Ajouter à » pour ce titre. Stable (préserve le `memo` des lignes). */
  onAdd: (track: LocalTrack) => void;
  /** Glissement d'une ligne : insère le titre juste après la piste en cours. Stable. */
  onPlayNext: (track: LocalTrack) => void;
  /** Feuille « Ajouter à », à rendre une fois dans l'arbre de l'écran. */
  element: ReactNode;
};

/** Action propre à un écran, ajoutée en tête de la barre de sélection (ex. « Retirer » d'une playlist). */
export type ExtraSelectionAction = {
  icon: IconName;
  label: string;
  /** Reçoit les pistes cochées dans l'ordre d'affichage ; la sélection se ferme ensuite. */
  onPress: (tracks: LocalTrack[]) => void;
};

export function useTrackListActions(
  visibleTracks: LocalTrack[],
  options?: { extraAction?: ExtraSelectionAction }
): TrackListActions {
  const extraAction = options?.extraAction;
  const { playNext, addToQueue } = usePlayer();
  const { setTracksExcluded, reloadTracks } = useLibrary();

  // `null` = mode normal ; un `Set` (même vide) = mode sélection.
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const active = selected !== null;
  // Pistes en attente dans « Ajouter à », et origine de la demande : un ajout venu de la
  // sélection en fait sortir, un ajout venu du « + » d'une ligne ne touche à rien d'autre.
  const [picker, setPicker] = useState<{ tracks: LocalTrack[]; fromSelection: boolean } | null>(
    null
  );

  const isSelected = useCallback((id: string) => selected?.has(id) ?? false, [selected]);

  const toggle = useCallback((track: LocalTrack) => {
    tapLight();
    setSelected((prev) => {
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

  const start = useCallback((track: LocalTrack) => {
    tapMedium();
    setSelected(new Set([track.id]));
  }, []);
  const cancel = useCallback(() => setSelected(null), []);

  // Retour Android : sort de la sélection avant toute navigation.
  useEffect(() => {
    if (!active) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      return true;
    });
    return () => sub.remove();
  }, [active]);

  const onAdd = useCallback((track: LocalTrack) => {
    tapLight();
    setPicker({ tracks: [track], fromSelection: false });
  }, []);

  const onPlayNext = useCallback(
    (track: LocalTrack) => {
      playNext([track]);
      showToast('Lira ensuite', 'playlist_play');
    },
    [playNext]
  );

  // Pistes cochées dans l'ordre d'affichage courant (pas l'ordre des taps).
  const selectedTracks = selected ? visibleTracks.filter((t) => selected.has(t.id)) : [];
  const count = selectedTracks.length;

  // « Tout » porte sur la liste affichée ; re-tap = tout désélectionner.
  const allSelected =
    active && visibleTracks.length > 0 && visibleTracks.every((t) => selected.has(t.id));
  const toggleAll = () => {
    tapLight();
    setSelected(allSelected ? new Set() : new Set(visibleTracks.map((t) => t.id)));
  };

  const addSelected = () => {
    // Ne sort pas du mode ici : `onAdded` le fera, après un ajout réussi seulement.
    setPicker({ tracks: selectedTracks, fromSelection: true });
  };

  const playNextSelected = () => {
    tapLight();
    playNext(selectedTracks);
    showToast(count > 1 ? `${count} titres liront ensuite` : 'Lira ensuite', 'playlist_play');
    setSelected(null);
  };

  const queueSelected = () => {
    tapLight();
    addToQueue(selectedTracks);
    showToast(count > 1 ? `${count} titres ajoutés à la file` : 'Ajouté à la file', 'queue_music');
    setSelected(null);
  };

  const excludeSelected = () => {
    tapMedium();
    setTracksExcluded(
      selectedTracks.map((t) => t.id),
      true
    );
    showToast(count > 1 ? `${count} titres masqués de la bibliothèque` : 'Titre masqué', 'block');
    setSelected(null);
  };

  const deleteSelected = () => {
    const toDelete = selectedTracks;
    const n = toDelete.length;
    Alert.alert(
      n > 1 ? `Supprimer ${n} titres du téléphone ?` : 'Supprimer du téléphone ?',
      n > 1
        ? `${n} fichiers seront définitivement supprimés de l’appareil.`
        : `« ${toDelete[0].title} » (${toDelete[0].filename}) sera définitivement supprimé de l’appareil.`,
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
                setSelected(null);
              } else {
                showToast('Suppression annulée ou refusée', 'block');
              }
            }),
        },
      ]
    );
  };

  const header = active ? (
    <Animated.View
      entering={FadeIn.duration(DURATION.base)}
      exiting={FadeOut.duration(DURATION.fast)}
      style={styles.bar}
    >
      <Text style={styles.count}>
        {count} sélectionné{count > 1 ? 's' : ''}
      </Text>
      <Pressable
        onPress={toggleAll}
        hitSlop={10}
        style={styles.barAction}
        accessibilityRole="button"
      >
        <Text style={styles.barActionLabel}>{allSelected ? 'Aucun' : 'Tout'}</Text>
      </Pressable>
      <Pressable onPress={cancel} hitSlop={10} style={styles.barAction} accessibilityRole="button">
        <Text style={styles.barActionLabel}>Annuler</Text>
      </Pressable>
    </Animated.View>
  ) : null;

  const footer = active ? (
    <Animated.View
      entering={SlideInDown.duration(DURATION.slow).easing(EASE_OUT)}
      exiting={SlideOutDown.duration(DURATION.base)}
      style={styles.footer}
    >
      {extraAction && (
        <FooterAction
          icon={extraAction.icon}
          label={extraAction.label}
          disabled={count === 0}
          onPress={() => {
            tapMedium();
            extraAction.onPress(selectedTracks);
            setSelected(null);
          }}
        />
      )}
      <FooterAction icon="add" label="Ajouter à" disabled={count === 0} onPress={addSelected} />
      <FooterAction
        icon="playlist_play"
        label="Lire ensuite"
        disabled={count === 0}
        onPress={playNextSelected}
      />
      <FooterAction
        icon="playlist_add"
        label="File"
        disabled={count === 0}
        onPress={queueSelected}
      />
      <FooterAction icon="block" label="Masquer" disabled={count === 0} onPress={excludeSelected} />
      <FooterAction
        icon="delete"
        label="Supprimer"
        disabled={count === 0}
        onPress={deleteSelected}
        destructive
      />
    </Animated.View>
  ) : null;

  const element = (
    <PlaylistPickerSheet
      tracks={picker?.tracks ?? null}
      onClose={() => setPicker(null)}
      onAdded={picker?.fromSelection ? cancel : undefined}
    />
  );

  return {
    selection: { active, isSelected, toggle, start, cancel, header, footer },
    onAdd,
    onPlayNext,
    element,
  };
}

/** Action de la barre du mode sélection (icône + libellé court, désactivée si sélection vide). */
function FooterAction({
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
      android_ripple={{ color: colors.borderStrong }}
      style={[styles.footerAction, disabled && styles.footerDisabled]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Icon name={icon} size={22} color={destructive ? colors.danger : colors.accentIcon} />
      <Text style={[styles.footerLabel, destructive && styles.footerLabelDanger]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    height: 40,
    paddingHorizontal: spacing.xxl,
  },
  count: {
    ...typography.heading,
    fontSize: 14,
    flex: 1,
  },
  barAction: {
    paddingVertical: spacing.xs,
  },
  barActionLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 13,
    color: colors.accentLabel,
  },
  footer: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: 2,
  },
  footerDisabled: {
    opacity: 0.4,
  },
  footerLabel: {
    ...typography.body,
    fontSize: 10.5,
    color: colors.textSecondary,
  },
  footerLabelDanger: {
    color: colors.danger,
  },
});
