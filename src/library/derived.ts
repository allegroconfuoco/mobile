import { useMemo } from 'react';

import { buildMergedArtists } from './artists';
import { buildAlbums, type AlbumGroup, type ArtistGroup } from './grouping';
import { useLibrary } from './LibraryProvider';
import type { LocalTrack } from './useAudioLibrary';

/**
 * Regroupements dérivés de la bibliothèque (artistes, albums), calculés **à la demande**.
 *
 * Ils ne servent qu'à l'onglet Artistes et à la recherche : les calculer dans le provider de la
 * bibliothèque les faisait payer à chaque démarrage, avant même le premier affichage de la liste
 * des morceaux. Ici, le premier écran qui en a besoin déclenche le calcul, et le résultat est
 * mémorisé contre la liste de pistes qui l'a produit — tous les écrans se partagent donc le même
 * résultat tant que la bibliothèque n'a pas changé.
 */
const artistsCache = new WeakMap<LocalTrack[], ArtistGroup[]>();
const albumsCache = new WeakMap<LocalTrack[], AlbumGroup[]>();

/** Artistes de la bibliothèque, collaborations rattachées aux artistes connus en solo. */
export function useArtists(): ArtistGroup[] {
  const { visibleTracks } = useLibrary();
  return useMemo(() => {
    let artists = artistsCache.get(visibleTracks);
    if (!artists) {
      artists = buildMergedArtists(visibleTracks);
      artistsCache.set(visibleTracks, artists);
    }
    return artists;
  }, [visibleTracks]);
}

/** Albums de la bibliothèque, triés par artiste puis titre. */
export function useAlbums(): AlbumGroup[] {
  const { visibleTracks } = useLibrary();
  return useMemo(() => {
    let albums = albumsCache.get(visibleTracks);
    if (!albums) {
      albums = buildAlbums(visibleTracks);
      albumsCache.set(visibleTracks, albums);
    }
    return albums;
  }, [visibleTracks]);
}
