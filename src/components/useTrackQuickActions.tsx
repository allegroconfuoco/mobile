import { useCallback, useState, type ReactNode } from 'react';

import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { showToast } from '@/components/Toast';
import { tapLight } from '@/lib/haptics';
import { useFavorites } from '@/library/FavoritesProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';

/**
 * Actions rapides d'une ligne de piste, mutualisées entre les écrans de liste (Morceaux, artiste,
 * album, favoris).
 *
 * Elles court-circuitent le parcours « appui long → feuille d'actions → action », qui coûtait
 * trois gestes pour les deux opérations les plus fréquentes :
 *  - **bouton du slot de droite** : tap = ajouter aux favoris ; re-tap (piste déjà likée) = ouvrir
 *    le sélecteur de playlists ; appui long = retirer des favoris ;
 *  - **glissement vers la droite** (`SwipeableRow`) : « Lire ensuite ».
 *
 * Les handlers sont stables (`useCallback` sans dépendance changeante) : c'est la condition pour
 * que le `memo` de `TrackIndexRow` serve à quelque chose sur des listes de plusieurs milliers de
 * lignes. Le seul état local est la piste dont le sélecteur de playlists est ouvert.
 */
export type TrackQuickActions = {
  /** Tap sur le bouton : favori si absent des favoris, sinon sélecteur de playlists. */
  onQuickAction: (track: LocalTrack) => void;
  /** Appui long sur le bouton : retire des favoris (sans effet si la piste n'y est pas). */
  onQuickActionLongPress: (track: LocalTrack) => void;
  /** Glissement vers la droite : insère juste après la piste en cours. */
  onPlayNext: (track: LocalTrack) => void;
  isFavorite: (trackId: string) => boolean;
  /** Sélecteur de playlists à rendre dans l'arbre de l'écran. */
  element: ReactNode;
};

export function useTrackQuickActions(): TrackQuickActions {
  const { isFavorite, toggleFavorite } = useFavorites();
  const { playNext } = usePlayer();
  const [pickerTrack, setPickerTrack] = useState<LocalTrack | null>(null);

  const onQuickAction = useCallback(
    (track: LocalTrack) => {
      tapLight();
      if (isFavorite(track.id)) {
        setPickerTrack(track);
        return;
      }
      toggleFavorite(track.id, track.mbid);
      showToast('Ajouté aux favoris', 'favorite');
    },
    [isFavorite, toggleFavorite]
  );

  const onQuickActionLongPress = useCallback(
    (track: LocalTrack) => {
      if (!isFavorite(track.id)) {
        return;
      }
      tapLight();
      toggleFavorite(track.id, track.mbid);
      showToast('Retiré des favoris', 'favorite');
    },
    [isFavorite, toggleFavorite]
  );

  const onPlayNext = useCallback(
    (track: LocalTrack) => {
      tapLight();
      void playNext([track]);
      showToast('Lira ensuite', 'queue_music');
    },
    [playNext]
  );

  return {
    onQuickAction,
    onQuickActionLongPress,
    onPlayNext,
    isFavorite,
    element: (
      <PlaylistPickerSheet
        tracks={pickerTrack ? [pickerTrack] : null}
        onClose={() => setPickerTrack(null)}
      />
    ),
  };
}
