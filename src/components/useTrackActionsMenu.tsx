import { useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';

import { TrackActionsSheet } from '@/components/TrackActionsSheet';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { useLibrary } from '@/library/LibraryProvider';
import { useFavorites } from '@/library/FavoritesProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { confirmRestoreTags } from '@/library/writeTags';
import * as db from '@/library/db';
import { usePlayer } from '@/player/PlayerProvider';

/**
 * Menu d'actions long-press mutualisé (bibliothèque, artiste, album, playlist, favoris).
 *
 * Regroupe l'état + le câblage auparavant dupliqués écran par écran : `open(track)` révèle le
 * `TrackActionsSheet`, qui peut à son tour ouvrir le `PlaylistPickerSheet`. L'écran appelant se
 * contente de câbler `onLongPress={open}` sur ses lignes et de rendre `element` dans son arbre.
 *
 * Tous les providers consommés (lecteur, favoris, bibliothèque) sont montés au-dessus des onglets,
 * donc le hook est utilisable depuis n'importe quel écran d'onglet.
 */
export function useTrackActionsMenu(): {
  open: (track: LocalTrack) => void;
  element: ReactNode;
} {
  const router = useRouter();
  const { setTrackExcluded, reloadTracks } = useLibrary();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { playNext, addToQueue } = usePlayer();

  // Piste dont le menu d'actions est ouvert, ou `null` si fermé.
  const [menuTrack, setMenuTrack] = useState<LocalTrack | null>(null);
  // Piste pour laquelle le sélecteur « Ajouter à une playlist » est ouvert, ou `null`.
  const [pickerTrack, setPickerTrack] = useState<LocalTrack | null>(null);

  const element = (
    <>
      <TrackActionsSheet
        title={menuTrack?.title ?? null}
        isFavorite={menuTrack ? isFavorite(menuTrack.id) : false}
        onClose={() => setMenuTrack(null)}
        onPlayNext={() => menuTrack && void playNext([menuTrack])}
        onAddToQueue={() => menuTrack && void addToQueue([menuTrack])}
        onToggleFavorite={() => menuTrack && toggleFavorite(menuTrack.id, menuTrack.mbid)}
        onAddToPlaylist={() => setPickerTrack(menuTrack)}
        onFixMetadata={() =>
          menuTrack && router.push({ pathname: '/metadata-fix', params: { trackId: menuTrack.id } })
        }
        onLinkAlbum={() =>
          menuTrack &&
          router.push({ pathname: '/identify-album', params: { trackId: menuTrack.id } })
        }
        onWriteToFile={() =>
          menuTrack && router.push({ pathname: '/write-tags', params: { trackId: menuTrack.id } })
        }
        onRestoreFile={() => menuTrack && confirmRestoreTags(menuTrack, reloadTracks)}
        hasFileBackup={menuTrack ? db.hasTagBackup(menuTrack.id) : false}
        onExclude={() => menuTrack && setTrackExcluded(menuTrack.id, true)}
      />

      <PlaylistPickerSheet track={pickerTrack} onClose={() => setPickerTrack(null)} />
    </>
  );

  return { open: setMenuTrack, element };
}
