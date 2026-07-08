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
import { normalizeForSearch } from './grouping';

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
