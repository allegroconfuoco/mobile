/**
 * Regroupement de la bibliothèque par artiste / album (issues #12 et #13) — logique pure.
 *
 * Toutes les métadonnées (artiste, album, album artist, n° de piste, pochette) sont désormais
 * persistées sur chaque `LocalTrack` au scan (cf. `useAudioLibrary`), donc ces fonctions
 * travaillent en mémoire sur la liste déjà filtrée par les préférences d'inclusion. Elles sont
 * partagées entre l'onglet Bibliothèque et les écrans détail (`app/artist.tsx`, `app/album.tsx`)
 * pour que le regroupement et le filtrage restent strictement cohérents.
 */
import type { ReleaseTrackRef } from './db';
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

/**
 * Motif « featuring » à retirer pour dériver l'artiste d'album à partir d'un champ artiste brut.
 *
 * Deux formes : la parenthèse/crochet « (feat. X) », et la queue « feat. X … » jusqu'à la fin.
 * **Volontairement conservateur** : on ne coupe QUE sur `feat/ft/featuring` (le motif dominant des
 * fichiers téléchargés), jamais sur `,` / `&` / `/` — sinon on casserait des noms de groupe légitimes
 * (« Earth, Wind & Fire », « Simon & Garfunkel », « AC/DC »). Les vrais multi-artistes séparés par
 * une virgule se nettoient à la main via l'écran de suppression d'artiste (override réversible).
 */
const FEATURING =
  /\s*[([]\s*(?:feat|ft|featuring)\.?\s+[^)\]]*[)\]]|\s+(?:feat|ft|featuring)\.?\s+.*$/gi;

/** Retire les mentions de featuring d'un nom d'artiste, en gardant l'original si tout serait vidé. */
export function stripFeaturing(name: string): string {
  const cleaned = name.replace(FEATURING, '').trim();
  return cleaned || name.trim();
}

/**
 * Artiste de l'album (regroupement). Le tag TPE2 prime, sinon repli sur l'interprète (TPE1). Dans
 * les deux cas on **retire le featuring** : ainsi « A » et « A feat. B » (même album, seul un titre
 * a un guest) retombent sur le même artiste d'album et **ne scindent plus l'album**, y compris quand
 * MusicBrainz ignore le featuring. L'interprète brut par piste reste affiché via `artistOf`.
 */
export function albumArtistOf(track: LocalTrack): string {
  const raw = track.albumArtist?.trim() || track.artist?.trim();
  if (!raw) {
    return UNKNOWN_ARTIST;
  }
  return stripFeaturing(raw);
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
    if (!group.artworkUri) {
      // Pochette locale (tag) en priorité, sinon celle récupérée par l'enrichissement (issue #19).
      group.artworkUri = t.artworkUri ?? t.coverArtUrl;
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
    if (!group.artworkUri) {
      // Pochette locale (tag) en priorité, sinon celle récupérée par l'enrichissement (issue #19).
      group.artworkUri = t.artworkUri ?? t.coverArtUrl;
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

// --- Titres fantômes (albums partiels identifiés) --------------------------------------------

/**
 * Une ligne du détail d'un album : soit un fichier local (`local`), soit une piste **manquante**
 * (`ghost`) connue par la tracklist de la release identifiée mais absente localement.
 */
export type AlbumRow =
  | { kind: 'local'; track: LocalTrack }
  | { kind: 'ghost'; disc: number; position: number; title: string };

/** Un disque de l'affichage détail, mêlant fichiers locaux et titres fantômes. */
export type AlbumRowDisc = {
  disc: number | null;
  data: AlbumRow[];
};

/** Disque d'une ligne : `discNo` du fichier local (repli `null`), ou disque de la piste release. */
function discOfRow(row: AlbumRow): number | null {
  return row.kind === 'local' ? (row.track.discNo ?? null) : row.disc;
}

/**
 * Trouve le fichier local correspondant à une piste de release, sans réutiliser un fichier déjà
 * apparié (`used`). D'abord par recording MBID (le plus fiable, posé par l'identification #23),
 * sinon par (disque, position) — l'identification aligne `discNo`/`trackNo` des locaux sur la
 * release, donc ce repli est fiable même sans MBID.
 */
function findLocalForEntry(
  albumTracks: LocalTrack[],
  entry: ReleaseTrackRef,
  used: Set<string>
): LocalTrack | null {
  if (entry.recordingMbid) {
    const byMbid = albumTracks.find(
      (t) => !used.has(t.id) && t.mbid != null && t.mbid === entry.recordingMbid
    );
    if (byMbid) {
      return byMbid;
    }
  }
  return (
    albumTracks.find(
      (t) => !used.has(t.id) && (t.discNo ?? 1) === entry.discNo && t.trackNo === entry.position
    ) ?? null
  );
}

/**
 * Fusionne les fichiers locaux d'un album avec la tracklist complète de sa release identifiée
 * (issue #23) : chaque piste de la release devient une ligne `local` (fichier possédé) ou `ghost`
 * (titre manquant), dans l'ordre de la release. Les fichiers locaux non appariés (bonus, ou hors
 * release) sont ajoutés en fin. Tracklist vide (album non identifié, ou identifié avant cette
 * feature) → aucun fantôme, on garde le comportement historique (locaux triés).
 */
export function mergeAlbumWithTracklist(
  albumTracks: LocalTrack[],
  tracklist: ReleaseTrackRef[]
): AlbumRow[] {
  if (tracklist.length === 0) {
    return [...albumTracks].sort(byDiscThenTrack).map((track) => ({ kind: 'local', track }));
  }
  const used = new Set<string>();
  const rows: AlbumRow[] = [];
  for (const entry of tracklist) {
    const local = findLocalForEntry(albumTracks, entry, used);
    if (local) {
      used.add(local.id);
      rows.push({ kind: 'local', track: local });
    } else {
      rows.push({
        kind: 'ghost',
        disc: entry.discNo,
        position: entry.position,
        title: entry.title ?? '',
      });
    }
  }
  const leftover = albumTracks.filter((t) => !used.has(t.id)).sort(byDiscThenTrack);
  for (const track of leftover) {
    rows.push({ kind: 'local', track });
  }
  return rows;
}

/** Découpe les lignes fusionnées (`mergeAlbumWithTracklist`) en disques consécutifs. */
export function groupAlbumRowsByDisc(rows: AlbumRow[]): AlbumRowDisc[] {
  const discs: AlbumRowDisc[] = [];
  for (const row of rows) {
    const disc = discOfRow(row);
    const last = discs[discs.length - 1];
    if (last && last.disc === disc) {
      last.data.push(row);
    } else {
      discs.push({ disc, data: [row] });
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
