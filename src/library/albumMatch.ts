/**
 * Rapprochement release MusicBrainz ↔ fichiers locaux par similarité de titre (issue #23).
 *
 * Pur (aucune I/O). Une fois l'utilisateur ayant choisi une release, on doit deviner quelle piste
 * locale correspond à quelle piste de la release pour poser l'overlay d'ordre. Les numéros de piste
 * locaux manquant (c'est tout le problème qu'on corrige), on ne peut se fier qu'au **titre**.
 *
 * Stratégie : score de similarité titre-à-titre (normalisé, cf. `normalizeForSearch`), puis
 * affectation gloutonne 1-à-1 (meilleure paire d'abord). Une release track sans correspondance
 * assez sûre reste `null` (piste manquante localement) ; une piste locale non affectée est ignorée
 * (bonus/hors-album) — d'où le « mapping partiel validé main » de l'issue.
 */
import { normalizeForSearch } from './grouping';
import type { ReleaseTrack } from './musicbrainzApi';
import type { LocalTrack } from './useAudioLibrary';

/** Une piste de release et le fichier local qu'on lui associe (ou `null` si aucun). */
export type ReleaseMapping = {
  release: ReleaseTrack;
  local: LocalTrack | null;
  /** Score de la correspondance retenue (0..1), `0` quand `local` est `null`. */
  score: number;
};

/** En dessous, on considère qu'il n'y a pas de correspondance fiable (piste manquante). */
const MIN_SCORE = 0.34;

function tokenize(value: string): string[] {
  return normalizeForSearch(value)
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
}

/**
 * Similarité de deux titres dans [0,1] : égalité normalisée = 1 ; inclusion de l'un dans l'autre
 * fortement récompensée ; sinon indice de Jaccard sur les mots. Volontairement simple et sans
 * dépendance — suffisant pour départager les pistes d'un même album.
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeForSearch(a);
  const nb = normalizeForSearch(b);
  if (na === '' || nb === '') {
    return 0;
  }
  if (na === nb) {
    return 1;
  }
  if (na.includes(nb) || nb.includes(na)) {
    return 0.9;
  }
  const ta = new Set(tokenize(a));
  const tb = tokenize(b);
  if (ta.size === 0 || tb.length === 0) {
    return 0;
  }
  let inter = 0;
  const seen = new Set<string>();
  for (const t of tb) {
    if (ta.has(t) && !seen.has(t)) {
      inter += 1;
      seen.add(t);
    }
  }
  const union = ta.size + new Set(tb).size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Associe chaque piste de la release (dans l'ordre) à au plus un fichier local, en 1-à-1 glouton :
 * on calcule tous les scores, on retient les meilleures paires d'abord, chaque piste locale n'étant
 * utilisée qu'une fois. Renvoie une entrée par piste de release, dans l'ordre de la release.
 */
export function matchReleaseTracks(
  releaseTracks: ReleaseTrack[],
  localTracks: LocalTrack[]
): ReleaseMapping[] {
  const pairs: { r: number; l: number; score: number }[] = [];
  releaseTracks.forEach((rt, r) => {
    localTracks.forEach((lt, l) => {
      const score = titleSimilarity(rt.title, lt.title);
      if (score >= MIN_SCORE) {
        pairs.push({ r, l, score });
      }
    });
  });
  // Meilleures correspondances d'abord ; à score égal, l'ordre est stable (indices croissants).
  pairs.sort((a, b) => b.score - a.score || a.r - b.r || a.l - b.l);

  const localFor = new Array<number>(releaseTracks.length).fill(-1);
  const usedLocal = new Set<number>();
  const scoreFor = new Array<number>(releaseTracks.length).fill(0);
  for (const p of pairs) {
    if (localFor[p.r] === -1 && !usedLocal.has(p.l)) {
      localFor[p.r] = p.l;
      usedLocal.add(p.l);
      scoreFor[p.r] = p.score;
    }
  }

  return releaseTracks.map((release, r) => ({
    release,
    local: localFor[r] === -1 ? null : localTracks[localFor[r]],
    score: scoreFor[r],
  }));
}
