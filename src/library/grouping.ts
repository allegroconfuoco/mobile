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

/** Position d'ordre, valeur manquante repoussée en fin. */
function pos(n: number | null): number {
  return n ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Ordonne deux pistes d'un même album : n° de disque (TPOS), puis n° de piste, puis titre.
 * Les albums mono-disque n'ont pas de `discNo` (tous à `MAX`) : ils sont donc départagés
 * directement par le n° de piste, comportement inchangé.
 */
function byDiscThenTrack(a: LocalTrack, b: LocalTrack): number {
  return (
    pos(a.discNo) - pos(b.discNo) || pos(a.trackNo) - pos(b.trackNo) || compare(a.title, b.title)
  );
}

/**
 * Pistes d'un album donné (clé renvoyée par `buildAlbums` / `makeAlbumKey`), ordonnées par
 * disque puis n° de piste puis titre. Les pistes sans numéro passent en fin de liste.
 */
export function tracksForAlbum(tracks: LocalTrack[], key: string): LocalTrack[] {
  return tracks.filter((t) => albumKeyOf(t) === key).sort(byDiscThenTrack);
}

/** Un disque d'un album, pour l'affichage sectionné du détail. */
export type AlbumDisc = {
  /** Numéro de disque, ou `null` si le tag est absent. */
  disc: number | null;
  data: LocalTrack[];
};

/**
 * Découpe des pistes d'album (déjà triées par `tracksForAlbum`) en disques consécutifs.
 * Renvoie une seule section pour un album mono-disque : l'UI n'affiche l'en-tête que s'il y en
 * a plusieurs.
 */
export function groupAlbumByDisc(albumTracks: LocalTrack[]): AlbumDisc[] {
  const discs: AlbumDisc[] = [];
  for (const t of albumTracks) {
    const last = discs[discs.length - 1];
    if (last && last.disc === (t.discNo ?? null)) {
      last.data.push(t);
    } else {
      discs.push({ disc: t.discNo ?? null, data: [t] });
    }
  }
  return discs;
}

/**
 * Ordonne les pistes d'un artiste par album (ordre de `buildAlbums`) puis disque/n° de piste :
 * sert de file de lecture cohérente et de découpage en sections pour l'écran détail artiste.
 */
export function orderArtistTracks(tracks: LocalTrack[]): LocalTrack[] {
  return [...tracks].sort((a, b) => compare(albumOf(a), albumOf(b)) || byDiscThenTrack(a, b));
}

/**
 * Recherche (issue #15) — filtrage texte insensible à la casse et aux accents.
 *
 * On replie les diacritiques pour que « riviere » trouve « Rivière ». Hermes récent
 * implémente `String.prototype.normalize`, mais on teste la présence une fois au chargement
 * et on retombe sur une petite table FR si l'appareil ne la supporte pas (dégradation propre :
 * les caractères non couverts restent comparés en minuscules).
 */
const SUPPORTS_NORMALIZE = (() => {
  try {
    return 'é'.normalize('NFC') === 'é';
  } catch {
    return false;
  }
})();

/** Repli sans `normalize` : diacritiques français + latin courant. */
const FOLD: Record<string, string> = {
  à: 'a',
  â: 'a',
  ä: 'a',
  á: 'a',
  ã: 'a',
  ç: 'c',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  î: 'i',
  ï: 'i',
  í: 'i',
  ì: 'i',
  ô: 'o',
  ö: 'o',
  ó: 'o',
  ò: 'o',
  õ: 'o',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ú: 'u',
  ñ: 'n',
  œ: 'oe',
  æ: 'ae',
  ß: 'ss',
};

/** Minuscule + sans accent, pour comparer requête et champs sur un même pied. */
export function normalizeForSearch(value: string): string {
  const lower = value.toLowerCase();
  if (SUPPORTS_NORMALIZE) {
    // NFD détache les diacritiques (U+0300–U+036F) ; on les retire ensuite. Filtrage par
    // point de code plutôt que par regex pour garder une source 100 % ASCII.
    let out = '';
    for (const ch of lower.normalize('NFD')) {
      const code = ch.charCodeAt(0);
      if (code < 0x0300 || code > 0x036f) {
        out += ch;
      }
    }
    return out.trim();
  }
  let out = '';
  for (const ch of lower) {
    out += FOLD[ch] ?? ch;
  }
  return out.trim();
}

/** Une piste correspond si le terme est présent dans son titre, artiste ou album. */
function matchesTrack(track: LocalTrack, needle: string): boolean {
  return (
    normalizeForSearch(track.title).includes(needle) ||
    normalizeForSearch(artistOf(track)).includes(needle) ||
    normalizeForSearch(albumOf(track)).includes(needle)
  );
}

/** Filtre les pistes sur titre / artiste / album. Requête vide = liste inchangée. */
export function filterTracks(tracks: LocalTrack[], query: string): LocalTrack[] {
  const needle = normalizeForSearch(query);
  if (!needle) {
    return tracks;
  }
  return tracks.filter((t) => matchesTrack(t, needle));
}

/** Filtre les artistes agrégés sur leur nom. Requête vide = liste inchangée. */
export function filterArtists(artists: ArtistGroup[], query: string): ArtistGroup[] {
  const needle = normalizeForSearch(query);
  if (!needle) {
    return artists;
  }
  return artists.filter((a) => normalizeForSearch(a.name).includes(needle));
}

/** Filtre les albums agrégés sur leur titre ou leur artiste. Requête vide = liste inchangée. */
export function filterAlbums(albums: AlbumGroup[], query: string): AlbumGroup[] {
  const needle = normalizeForSearch(query);
  if (!needle) {
    return albums;
  }
  return albums.filter(
    (a) =>
      normalizeForSearch(a.title).includes(needle) || normalizeForSearch(a.artist).includes(needle)
  );
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
