/**
 * Découpe et édition d'un champ artiste multi-artistes — logique pure (aucune IO).
 *
 * Le tag ID3 TPE1 est une chaîne unique où plusieurs artistes sont collés de façons variées :
 * « A feat. B », « A, B », « A & B », « A x B », « A (feat. B) ». Pour l'outil de suppression
 * d'artiste (retirer un guest d'un titre / de tout un album), on découpe cette chaîne en composants
 * individuels, puis on la recompose sans l'artiste retiré.
 *
 * ⚠️ La découpe est **heuristique et volontairement plus agressive** que `stripFeaturing`
 * (grouping.ts) : ici l'utilisateur voit et valide le résultat, donc on coupe aussi sur `,`/`&`/`/`.
 * Effet de bord assumé : un vrai nom de groupe (« Earth, Wind & Fire ») apparaît éclaté en plusieurs
 * artistes — l'utilisateur n'a alors qu'à ne rien retirer. Le regroupement automatique d'album, lui,
 * reste conservateur (featuring seulement).
 */
import { albumKeyOf, artistOf, normalizeForSearch, type ArtistGroup } from './grouping';
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

/** Découpe un champ artiste en artistes individuels (ordre préservé, doublons repliés, vides retirés). */
export function splitArtists(name: string | null | undefined): string[] {
  if (!name) {
    return [];
  }
  const parts = flattenBrackets(name)
    .split(SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = normalizeForSearch(p);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** Recompose un champ artiste depuis ses composants (jointure propre par « , »). */
export function joinArtists(parts: string[]): string {
  return parts.join(', ');
}

/**
 * Retire un artiste d'un champ artiste et renvoie la chaîne recomposée.
 *
 * Comparaison insensible à la casse/aux accents. Si l'artiste n'est pas présent, la chaîne
 * d'origine est renvoyée **inchangée** (on préserve son formatage). Si retirer viderait
 * entièrement le champ (c'était le seul artiste), on renvoie `null` : l'appelant doit alors ne rien
 * écrire (un titre ne peut pas se retrouver sans artiste).
 */
export function removeArtist(name: string | null | undefined, target: string): string | null {
  const parts = splitArtists(name);
  const t = normalizeForSearch(target);
  const kept = parts.filter((p) => normalizeForSearch(p) !== t);
  if (kept.length === parts.length) {
    // Rien retiré : garder l'original tel quel (formatage préservé).
    return name?.trim() || null;
  }
  if (kept.length === 0) {
    return null;
  }
  return joinArtists(kept);
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
      const key = normalizeForSearch(parts[0]);
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
    const canonical = solo.get(normalizeForSearch(rawArtist));
    return [canonical ?? rawArtist];
  }
  const hits: string[] = [];
  for (const part of parts) {
    const canonical = solo.get(normalizeForSearch(part));
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
 * solo connu reste une entrée à part entière. Même forme de sortie que `buildArtists` (grouping).
 */
export function buildMergedArtists(tracks: LocalTrack[]): ArtistGroup[] {
  const solo = buildSoloIndex(tracks);
  const map = new Map<
    string,
    { name: string; trackCount: number; albums: Set<string>; artworkUri: string | null }
  >();
  for (const t of tracks) {
    for (const name of groupNamesFor(artistOf(t), solo)) {
      const key = normalizeForSearch(name);
      let group = map.get(key);
      if (!group) {
        group = { name, trackCount: 0, albums: new Set(), artworkUri: null };
        map.set(key, group);
      }
      group.trackCount += 1;
      group.albums.add(albumKeyOf(t));
      if (!group.artworkUri) {
        group.artworkUri = t.artworkUri ?? t.coverArtUrl;
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
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/**
 * Pistes d'un artiste de la vue fusionnée (nom renvoyé par `buildMergedArtists`) : ses pistes solo
 * **et** ses collaborations. Remplace `tracksForArtist` (grouping) partout où l'écran détail /
 * les lots doivent refléter la vue Artistes.
 */
export function tracksForMergedArtist(tracks: LocalTrack[], name: string): LocalTrack[] {
  const solo = buildSoloIndex(tracks);
  const needle = normalizeForSearch(name);
  return tracks.filter((t) =>
    groupNamesFor(artistOf(t), solo).some((n) => normalizeForSearch(n) === needle)
  );
}
