/**
 * Découpe d'un champ artiste multi-artistes et vue Artistes fusionnée — logique pure (aucune IO).
 *
 * Le tag ID3 TPE1 est une chaîne unique où plusieurs artistes sont collés de façons variées :
 * « A feat. B », « A, B », « A & B », « A x B », « A (feat. B) ». On la découpe en composants
 * individuels pour rattacher une collaboration à chacun de ses artistes.
 *
 * ⚠️ La découpe est **heuristique et volontairement plus agressive** que `stripFeaturing`
 * (grouping.ts) : elle coupe aussi sur `,`/`&`/`/`. Un vrai nom de groupe (« Earth, Wind & Fire »)
 * sortirait éclaté — d'où le garde-fou de `groupNamesFor` plus bas. Le regroupement d'album, lui,
 * reste conservateur (featuring seulement).
 */
import { albumKeyOf, artistOf, foldKey, type ArtistGroup } from './grouping';
import type { LocalTrack } from './useAudioLibrary';

/**
 * Sépare parenthèses/crochets de featuring en séparateur plat, puis normalise les délimiteurs.
 * « A (feat. B) » → « A , B » ; les crochets/parenthèses fermantes deviennent une espace.
 */
function flattenBrackets(name: string): string {
  return name.replace(/[([]\s*(?:feat|ft|featuring)\.?\s*/gi, ', ').replace(/[)\]]/g, ' ');
}

/**
 * Séparateurs entre artistes. `,` `;` `&` `/` sont toujours des séparateurs ; `feat`/`ft`/
 * `featuring`, `x`, `vs`, `with` exigent des espaces autour (pour ne pas couper « Malcolm X » ni
 * « feather »).
 */
const SEPARATORS =
  /\s*,\s*|\s*;\s*|\s*&\s*|\s*\/\s*|\s+(?:feat|ft|featuring)\.?\s+|\s+x\s+|\s+vs\.?\s+|\s+with\s+/gi;

/**
 * Découpes mémorisées : la vue fusionnée découpe le champ artiste de chaque piste, et la même
 * chaîne revient pour tous les titres d'un artiste. Bornée par le nombre d'artistes distincts.
 */
const splitCache = new Map<string, string[]>();

/** Découpe un champ artiste en artistes individuels (ordre préservé, doublons repliés, vides retirés). */
export function splitArtists(name: string | null | undefined): string[] {
  if (!name) {
    return [];
  }
  const cached = splitCache.get(name);
  if (cached) {
    return cached;
  }
  const parts = flattenBrackets(name)
    .split(SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = foldKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  splitCache.set(name, out);
  return out;
}

// --- Vue Artistes fusionnée (multi-artistes rattachés aux artistes solo connus) ----------------
//
// La vue Artistes groupait sur le champ artiste **brut** : « Fred again.. & Baby Keem » formait un
// artiste distinct de « Fred again.. ». Ici, une piste multi-artistes est rattachée aux artistes
// **qui existent déjà en solo** dans la bibliothèque (comparaison pliée casse/accents). Garde-fou
// pour les vrais noms de groupe : si AUCUN composant n'existe en solo, le nom complet est conservé
// tel quel (« Earth, Wind & Fire » ne s'éclate pas tant qu'on n'a pas de piste de « Wind » seul).
// Effet de bord voulu : deux graphies solo (« Fred Again.. » / « Fred again.. ») fusionnent aussi,
// sous la première graphie rencontrée.

/** Index des artistes « solo » : nom normalisé → graphie canonique (première rencontrée). */
function buildSoloIndex(tracks: LocalTrack[]): Map<string, string> {
  const solo = new Map<string, string>();
  for (const t of tracks) {
    const parts = splitArtists(artistOf(t));
    if (parts.length === 1) {
      const key = foldKey(parts[0]);
      if (!solo.has(key)) {
        solo.set(key, parts[0]);
      }
    }
  }
  return solo;
}

/** Noms (canoniques) des groupes d'artistes auxquels une piste appartient. */
function groupNamesFor(rawArtist: string, solo: Map<string, string>): string[] {
  const parts = splitArtists(rawArtist);
  if (parts.length <= 1) {
    const canonical = solo.get(foldKey(rawArtist));
    return [canonical ?? rawArtist];
  }
  const hits: string[] = [];
  for (const part of parts) {
    const canonical = solo.get(foldKey(part));
    if (canonical && !hits.includes(canonical)) {
      hits.push(canonical);
    }
  }
  // Aucun composant connu en solo : probable nom de groupe, on le garde entier.
  return hits.length > 0 ? hits : [rawArtist];
}

/**
 * Regroupe les pistes par artiste pour la vue Artistes, en rattachant les pistes multi-artistes
 * (« A & B », « A, B », « A feat. B ») à chaque artiste **connu en solo** ; une collab sans aucun
 * solo connu reste une entrée à part entière.
 */
export function buildMergedArtists(tracks: LocalTrack[]): ArtistGroup[] {
  const solo = buildSoloIndex(tracks);
  const map = new Map<
    string,
    { name: string; trackCount: number; albums: Set<string>; artworkUri: string | null }
  >();
  for (const t of tracks) {
    for (const name of groupNamesFor(artistOf(t), solo)) {
      const key = foldKey(name);
      let group = map.get(key);
      if (!group) {
        group = { name, trackCount: 0, albums: new Set(), artworkUri: null };
        map.set(key, group);
      }
      group.trackCount += 1;
      group.albums.add(albumKeyOf(t));
      if (!group.artworkUri) {
        group.artworkUri = t.artworkUri;
      }
    }
  }
  return [...map.values()]
    .map((g) => ({
      name: g.name,
      trackCount: g.trackCount,
      albumCount: g.albums.size,
      artworkUri: g.artworkUri,
    }))
    .sort((a, b) => {
      const ka = foldKey(a.name);
      const kb = foldKey(b.name);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}

/**
 * Pistes d'un artiste de la vue fusionnée (nom renvoyé par `buildMergedArtists`) : ses pistes solo
 * **et** ses collaborations.
 */
export function tracksForMergedArtist(tracks: LocalTrack[], name: string): LocalTrack[] {
  const solo = buildSoloIndex(tracks);
  const needle = foldKey(name);
  return tracks.filter((t) => groupNamesFor(artistOf(t), solo).some((n) => foldKey(n) === needle));
}

/**
 * Artistes (noms de la vue fusionnée) auxquels une piste est rattachée : un seul en général,
 * plusieurs pour une collaboration entre artistes connus en solo. Sert à « Aller à l'artiste »
 * depuis le lecteur, qui doit ouvrir une page artiste non vide.
 */
export function artistPagesForTrack(tracks: LocalTrack[], track: LocalTrack): string[] {
  return groupNamesFor(artistOf(track), buildSoloIndex(tracks));
}
