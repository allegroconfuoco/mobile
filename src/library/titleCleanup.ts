import { normalizeForSearch } from './grouping';

/**
 * Nettoyage de titres par motifs personnalisables (lot 10 de l'audit).
 *
 * Une règle = un **motif à retirer** du titre, saisi par l'utilisateur ou pris dans les presets.
 * Tokens reconnus (le reste est du texte littéral, insensible à la casse) :
 *  - `$artiste` : le nom de l'artiste connu (comparaison insensible à la casse ; la variante
 *    sans accents — `normalizeForSearch` — est aussi acceptée) ;
 *  - `$()` : tout groupe parenthésé `( … )` ;
 *  - `$[]` : tout groupe entre crochets `[ … ]` ;
 *  - `$num` : n° de piste en tête (nombre + ponctuation de séparation — un espace seul ne suffit
 *    volontairement pas : « 99 Luftballons » ne doit jamais être touché) ;
 *  - `$feat` : suffixe featuring (`feat.` / `ft.` / `featuring` + noms).
 *
 * Les règles s'appliquent séquentiellement, puis `tidy` retire les séparateurs orphelins. Un
 * résultat vide retombe sur le titre d'origine (on ne grave jamais un titre vide). Module **pur**
 * (aucune IO) : vérifié par harnais tsx.
 */

/** Presets proposés dans l'éditeur de règles, repris des heuristiques de `matchQuery`. */
export const CLEANUP_PRESETS: readonly { rule: string; label: string }[] = [
  { rule: '$()', label: 'Parenthèses' },
  { rule: '$[]', label: 'Crochets' },
  { rule: '$artiste', label: 'Nom de l’artiste' },
  { rule: '$num', label: 'N° de piste en tête' },
  { rule: '$feat', label: 'feat. / ft.' },
] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fragment regex du nom d'artiste : forme exacte OU forme repliée (casse gérée par le flag i). */
function artistFragment(artist: string | null): string | null {
  const name = artist?.trim();
  if (!name) {
    return null;
  }
  const variants = new Set<string>([escapeRegExp(name)]);
  const folded = normalizeForSearch(name);
  if (folded.length > 0 && folded !== name.toLowerCase()) {
    variants.add(escapeRegExp(folded));
  }
  return `(?:${[...variants].join('|')})`;
}

/**
 * Compile un motif en RegExp (globale, insensible à la casse), ou `null` si la règle est vide ou
 * inapplicable (`$artiste` sans artiste connu).
 */
export function compileRule(rule: string, artist: string | null): RegExp | null {
  const pattern = rule.trim();
  if (pattern.length === 0) {
    return null;
  }
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern.startsWith('$artiste', i)) {
      const frag = artistFragment(artist);
      if (!frag) {
        return null;
      }
      out += frag;
      i += '$artiste'.length;
    } else if (pattern.startsWith('$()', i)) {
      out += '\\([^()]*\\)';
      i += 3;
    } else if (pattern.startsWith('$[]', i)) {
      out += '\\[[^\\[\\]]*\\]';
      i += 3;
    } else if (pattern.startsWith('$num', i)) {
      // Ancré en tête quand le token ouvre la règle : c'est un préfixe de n° de piste. Une
      // ponctuation de séparation est requise — un espace seul ne suffit pas, sinon
      // « 99 Luftballons » perdrait son 99.
      out += (i === 0 ? '^\\s*' : '') + '\\d{1,3}\\s*[-–—.)_]+\\s*';
      i += '$num'.length;
    } else if (pattern.startsWith('$feat', i)) {
      // `\b` obligatoires : sans elles, « ft » matche dans « Daft Punk » (bug réel de #18).
      out += '\\b(?:featuring|feat|ft)\\b\\.?\\s+[^()\\[\\]]*';
      i += '$feat'.length;
    } else {
      out += escapeRegExp(pattern[i]);
      i += 1;
    }
  }
  try {
    return new RegExp(out, 'gi');
  } catch {
    return null;
  }
}

/** Retire les séparateurs orphelins laissés par les retraits, sans jamais renvoyer une chaîne vide. */
function tidy(cleaned: string, fallback: string): string {
  let out = cleaned.replace(/\s{2,}/g, ' ').trim();
  // Séparateurs consécutifs (« Titre -  - reste » après retrait d'un segment central).
  out = out.replace(/(\s*[-–—·|]\s+)(?:[-–—·|]\s+)+/g, '$1');
  // Séparateurs/ponctuation orphelins en tête et en queue.
  out = out.replace(/^[\s\-–—·|:,]+/, '').replace(/[\s\-–—·|,]+$/, '');
  out = out.trim();
  return out.length > 0 ? out : fallback.trim();
}

/**
 * Applique les règles au titre brut (celui du **fichier**) et renvoie le titre nettoyé.
 * Idempotent sur un titre déjà propre ; retombe sur le titre d'origine si tout serait retiré.
 */
export function applyCleanupRules(raw: string, rules: string[], artist: string | null): string {
  let out = raw;
  for (const rule of rules) {
    const re = compileRule(rule, artist);
    if (re) {
      out = out.replace(re, ' ');
    }
  }
  return tidy(out, raw);
}

/** Règles par défaut proposées à la première ouverture (les plus sûres). */
export const DEFAULT_RULES: readonly string[] = ['$()', '$[]'] as const;
