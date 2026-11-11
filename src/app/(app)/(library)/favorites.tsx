import { useMemo } from 'react';

import { TrackListScreen } from '@/components/TrackListScreen';
import { useFavorites } from '@/library/FavoritesProvider';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';

import { countLabel } from '@/tabs/shared';

/** Favoris : les titres likés, le plus récent en tête. */
export default function FavoritesScreen() {
  const { tracksById } = useLibrary();
  const { favoriteIds, toggleFavorite } = useFavorites();

  // Ordre du `Set` (dernier liké d'abord) ; un favori dont le fichier a disparu est omis.
  const tracks = useMemo(() => {
    const list: LocalTrack[] = [];
    for (const id of favoriteIds) {
      const track = tracksById.get(id);
      if (track) {
        list.push(track);
      }
    }
    return list;
  }, [favoriteIds, tracksById]);

  const sections = useMemo(() => [{ key: 'favorites', data: tracks }], [tracks]);

  return (
    <TrackListScreen
      kind="Playlist"
      title="Favoris"
      meta={countLabel(tracks.length, 'titre')}
      cover={{ uri: null, icon: 'favorite', seed: 'favoris' }}
      context="favorites"
      source={{ kind: 'favorites' }}
      sections={sections}
      emptyText="Aucun favori pour l’instant. Touche le « + » d’un titre, puis « Favoris »."
      extraAction={{
        icon: 'favorite_border',
        label: 'Retirer',
        onPress: (selected) => selected.forEach((track) => toggleFavorite(track.id)),
      }}
    />
  );
}
