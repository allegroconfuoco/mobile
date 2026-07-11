/**
 * Masques de réécriture — demande utilisateur : une fois un artiste « validé » (tags corrigés),
 * pouvoir le **masquer** des écrans d'édition en lot (associer un artiste, nettoyer les titres)
 * pour ne pas re-vérifier les mêmes lignes à chaque passe.
 *
 * Une liste unique de noms d'artistes, persistée dans `app_settings` et **partagée entre les
 * écrans** de réécriture ; la comparaison est insensible à la casse et aux accents
 * (`normalizeForSearch`, même pliage que la recherche bibliothèque). Chaque écran garde une
 * bascule locale « afficher les masqués » pour retrouver les lignes cachées sans rien perdre.
 */
import * as db from './db';
import { normalizeForSearch } from './grouping';

const SETTING_KEY = 'rewrite.maskedArtists';

/** Lit la liste persistée des artistes masqués (vide si absente ou corrompue). */
export function loadMaskedArtists(): string[] {
  const raw = db.getSetting(SETTING_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return parsed;
      }
    } catch {
      // Valeur corrompue : on repart d'une liste vide.
    }
  }
  return [];
}

export function saveMaskedArtists(names: readonly string[]): void {
  db.setSetting(SETTING_KEY, JSON.stringify(names));
}

/** Ensemble des noms pliés (casse/accents), pour tester l'appartenance en O(1). */
export function maskSet(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.map((n) => normalizeForSearch(n)));
}

/** Vrai si cet artiste (nom affiché ou tag) correspond à un masque. */
export function isMasked(masks: ReadonlySet<string>, artist: string | null | undefined): boolean {
  return !!artist && masks.has(normalizeForSearch(artist));
}
