import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SectionLabel, TrackListScreen, type TrackSection } from '@/components/TrackListScreen';
import {
  albumArtistOf,
  groupAlbumByDisc,
  makeAlbumKey,
  tracksForAlbum,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
} from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';

import { countLabel } from '@/tabs/shared';

/**
 * Détail d'un album : ses pistes dans l'ordre (disque, puis n° de piste, puis titre).
 *
 * Reçoit `artist` (artiste de l'album) et `title` en paramètres, reconstruit la clé d'album et
 * filtre la bibliothèque partagée — tout dérive de la même source que la grille d'albums. Un album
 * multi-disques est sectionné par disque ; un album mono-disque n'affiche aucun en-tête.
 */
export default function AlbumScreen() {
  const params = useLocalSearchParams<{ artist?: string; title?: string }>();
  const artist = params.artist ?? UNKNOWN_ARTIST;
  const title = params.title ?? UNKNOWN_ALBUM;
  const { tracks } = useLibrary();

  const { albumTracks, sections } = useMemo(() => {
    const ordered = tracksForAlbum(tracks, makeAlbumKey(artist, title));
    const discs = groupAlbumByDisc(ordered);
    const multiDisc = discs.length > 1;
    return {
      albumTracks: ordered,
      sections: discs.map<TrackSection>((disc, i) => ({
        key: `disc-${disc.disc ?? i}`,
        header: multiDisc ? <SectionLabel label={`Disque ${disc.disc ?? '?'}`} /> : undefined,
        data: disc.data,
      })),
    };
  }, [tracks, artist, title]);

  const cover = albumTracks.map((t) => t.artworkUri).find(Boolean) ?? null;

  // Sur un album, la pochette est déjà en tête : chaque ligne porte son numéro de piste, et
  // l'interprète seulement s'il diffère de l'artiste de l'album (invités, compilations).
  const rowProps = (track: LocalTrack, index: number) => ({
    leadingNumber: track.trackNo ?? index + 1,
    subtitle: albumArtistOf(track) === (track.artist ?? '').trim() ? '' : (track.artist ?? ''),
  });

  return (
    <TrackListScreen
      kind="Album"
      title={title}
      subtitle={artist}
      meta={countLabel(albumTracks.length, 'titre')}
      cover={{ uri: cover, icon: 'album', seed: `${title}${artist}` }}
      context="album"
      source={{ kind: 'album', artist, title }}
      sections={sections}
      rowProps={rowProps}
      emptyText="Album introuvable."
    />
  );
}
