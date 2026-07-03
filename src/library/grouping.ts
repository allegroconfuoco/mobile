/**
 * Regroupement de la bibliothèque par artiste / album (issues #12 et #13) — logique pure.
 *
 * Toutes les métadonnées (artiste, album, album artist, n° de piste, pochette) sont désormais
 * persistées sur chaque `LocalTrack` au scan (cf. `useAudioLibrary`), donc ces fonctions
 * travaillent en mémoire sur la liste déjà filtrée par les préférences d'inclusion. Elles sont
 * partagées entre l'onglet Bibliothèque et les écrans détail (`app/artist.tsx`, `app/album.tsx`)
 * pour que le regroupement et le filtrage restent strictement cohérents.
 */
import type { LocalTrack } from './useAudioLibrary';

export const UNKNOWN_ARTIST = 'Artiste inconnu';
export const UNKNOWN_ALBUM = 'Album inconnu';

/** Séparateur interne des clés composées (album artist + album), jamais affiché (unit separator). */
const SEP = '\u0000';

/** Comparaison texte insensible à la casse et aux accents, ordre français. */
function compare(a: string, b: string): number {
  return a.localeCompare(b, 'fr', { sensitivity: 'base' });
}

/** Artiste interprète (TPE1) affiché, avec repli. */
export function artistOf(track: LocalTrack): string {
  return track.artist?.trim() || UNKNOWN_ARTIST;
}

/** Artiste de l'album (TPE2, repli sur l'interprète) : regroupe les compilations. */
export function albumArtistOf(track: LocalTrack): string {
  return track.albumArtist?.trim() || track.artist?.trim() || UNKNOWN_ARTIST;
}

/** Nom d'album affiché, avec repli. */
export function albumOf(track: LocalTrack): string {
  return track.album?.trim() || UNKNOWN_ALBUM;
}

/** Reconstruit la clé d'un album depuis ses composantes (côté écran détail, via params de route). */
export function makeAlbumKey(albumArtist: string, album: string): string {
  return `${albumArtist}${SEP}${album}`;
}

/** Clé stable d'un album : deux albums homonymes d'artistes différents restent distincts. */
export function albumKeyOf(track: LocalTrack): string {
  return makeAlbumKey(albumArtistOf(track), albumOf(track));
}

/** Un artiste de la bibliothèque, agrégé. */
export type ArtistGroup = {
  /** Nom affiché (= clé de regroupement pour l'écran détail). */
  name: string;
  trackCount: number;
  albumCount: number;
  /** Pochette représentative (première disponible), ou `null`. */
  artworkUri: string | null;
};

/** Un album de la bibliothèque, agrégé. */
export type AlbumGroup = {
  /** Clé stable (album artist + titre) — passée à l'écran détail. */
  key: string;
  title: string;
  artist: string;
  trackCount: number;
  artworkUri: string | null;
};

/** Regroupe les pistes par artiste interprète, triées par nom. */
export function buildArtists(tracks: LocalTrack[]): ArtistGroup[] {
  const map = new Map<
    string,
    { trackCount: number; albums: Set<string>; artworkUri: string | null }
  >();
  for (const t of tracks) {
    const name = artistOf(t);
    let group = map.get(name);
    if (!group) {
      group = { trackCount: 0, albums: new Set(), artworkUri: null };
      map.set(name, group);
    }
    group.trackCount += 1;
    group.albums.add(albumKeyOf(t));
    if (!group.artworkUri && t.artworkUri) {
      group.artworkUri = t.artworkUri;
    }
  }
  return [...map.entries()]
    .map(([name, g]) => ({
      name,
      trackCount: g.trackCount,
      albumCount: g.albums.size,
      artworkUri: g.artworkUri,
    }))
    .sort((a, b) => compare(a.name, b.name));
}

/** Regroupe les pistes par album, triées par artiste puis titre. */
export function buildAlbums(tracks: LocalTrack[]): AlbumGroup[] {
  const map = new Map<
    string,
    { title: string; artist: string; trackCount: number; artworkUri: string | null }
  >();
  for (const t of tracks) {
    const key = albumKeyOf(t);
    let group = map.get(key);
    if (!group) {
      group = { title: albumOf(t), artist: albumArtistOf(t), trackCount: 0, artworkUri: null };
      map.set(key, group);
    }
    group.trackCount += 1;
    if (!group.artworkUri && t.artworkUri) {
      group.artworkUri = t.artworkUri;
    }
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => compare(a.artist, b.artist) || compare(a.title, b.title));
}

/** Pistes d'un artiste donné (nom exact renvoyé par `buildArtists`). */
export function tracksForArtist(tracks: LocalTrack[], name: string): LocalTrack[] {
  return tracks.filter((t) => artistOf(t) === name);
}

/** Compare deux pistes par n° de piste (celles sans numéro en fin) puis titre. */
function byTrackNo(a: LocalTrack, b: LocalTrack): number {
  const na = a.trackNo ?? Number.MAX_SAFE_INTEGER;
  const nb = b.trackNo ?? Number.MAX_SAFE_INTEGER;
  return na - nb || compare(a.title, b.title);
}

/**
 * Pistes d'un album donné (clé renvoyée par `buildAlbums` / `makeAlbumKey`), ordonnées par
 * n° de piste puis titre. Les pistes sans numéro passent en fin de liste.
 */
export function tracksForAlbum(tracks: LocalTrack[], key: string): LocalTrack[] {
  return tracks.filter((t) => albumKeyOf(t) === key).sort(byTrackNo);
}

/**
 * Ordonne les pistes d'un artiste par album (ordre de `buildAlbums`) puis n° de piste : sert de
 * file de lecture cohérente et de découpage en sections pour l'écran détail artiste.
 */
export function orderArtistTracks(tracks: LocalTrack[]): LocalTrack[] {
  return [...tracks].sort((a, b) => compare(albumOf(a), albumOf(b)) || byTrackNo(a, b));
}

/** Critère de tri de la liste des morceaux. */
export type TrackSort = 'title' | 'artist';

/** Trie une copie des pistes par titre ou par artiste (puis titre). */
export function sortTracks(tracks: LocalTrack[], sort: TrackSort): LocalTrack[] {
  const copy = [...tracks];
  if (sort === 'artist') {
    copy.sort((a, b) => compare(artistOf(a), artistOf(b)) || compare(a.title, b.title));
  } else {
    copy.sort((a, b) => compare(a.title, b.title));
  }
  return copy;
}
