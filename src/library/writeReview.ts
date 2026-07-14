/**
 * Modèle **pur** de la revue avant gravure (write-back ID3).
 *
 * Avant d'écrire les tags dans le fichier, l'utilisateur revoit chaque champ : il voit la valeur du
 * **tag fichier** (« base ») et la valeur **MusicBrainz** (overlay, quand elle existe), choisit la
 * source par champ, ou saisit une valeur **perso**. Ce module ne fait que calculer : état initial,
 * valeur résolue par champ, jeu de tags final à graver. Aucune IO, aucun React — vérifié par un
 * harnais séparé et réutilisé tel quel en mode 1 piste comme en mode lot.
 *
 * N'importe que des **types** de `db` (`TagBackup`, `MbTags`) : l'import est erasé à la compilation,
 * donc ce module reste testable hors appareil (pas de dépendance runtime à SQLite / React Native).
 */
import type { LocalTrack } from './useAudioLibrary';
import type { MbTags, TagBackup } from './db';

/** Les six champs de tag texte/numérique qu'on grave. */
export type FieldKey = 'title' | 'artist' | 'album' | 'albumArtist' | 'trackNo' | 'discNo';

/** D'où vient la valeur d'un champ : tag fichier, MusicBrainz, ou saisie manuelle. */
export type FieldSource = 'file' | 'mb' | 'manual';

/** Choix de pochette à graver (cf. `writeTags`). */
export type CoverChoice = 'keep' | 'remote' | 'none';

export const TEXT_FIELDS = ['title', 'artist', 'album', 'albumArtist'] as const;
export const NUMBER_FIELDS = ['trackNo', 'discNo'] as const;
export const ALL_FIELDS: FieldKey[] = [...TEXT_FIELDS, ...NUMBER_FIELDS];

/**
 * Champs pour lesquels l'overlay MusicBrainz **prime par défaut** quand il existe : c'est le rôle de
 * l'enrichissement (corriger l'album mal/pas taggé, remettre l'ordre des pistes). Pour titre/artiste
 * on part au contraire du **tag fichier** (ce que l'utilisateur possède déjà) — ça reproduit
 * exactement ce que `loadTracks` écrirait aujourd'hui, la revue ne fait qu'exposer le choix inverse.
 */
const PREFERS_MB = new Set<FieldKey>(['album', 'albumArtist', 'trackNo', 'discNo']);

export type FieldState = {
  source: FieldSource;
  /** Texte saisi (n'a de sens que si `source === 'manual'`). */
  manual: string;
};

/** État complet de la revue d'une piste (une par piste, y compris en lot). */
export type TrackReview = {
  trackId: string;
  filename: string;
  /** Valeurs tag fichier (base). */
  base: TagBackup;
  /** Valeurs MusicBrainz (overlay), ou `null` si la piste n'a jamais été enrichie. */
  mb: MbTags | null;
  fields: Record<FieldKey, FieldState>;
  cover: CoverChoice;
  /** Une pochette distante est-elle disponible (active le choix « MusicBrainz ») ? */
  hasRemoteCover: boolean;
};

/** Une valeur (texte ou nombre) est-elle réellement présente (non nulle, non vide) ? */
export function hasValue(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) {
    return false;
  }
  return typeof v === 'number' ? Number.isFinite(v) : v.trim().length > 0;
}

/** Valeur d'un champ pour une source donnée (brute : string | number | null). */
function rawFor(review: TrackReview, key: FieldKey, source: FieldSource): string | number | null {
  if (source === 'manual') {
    return review.fields[key].manual;
  }
  const src = source === 'file' ? review.base : review.mb;
  return src ? (src[key] ?? null) : null;
}

/** Source par défaut d'un champ : MusicBrainz quand il prime *et* a une valeur, sinon le fichier. */
export function defaultSource(base: TagBackup, mb: MbTags | null, key: FieldKey): FieldSource {
  if (PREFERS_MB.has(key) && mb && hasValue(mb[key])) {
    return 'mb';
  }
  return 'file';
}

/** Prépare la revue d'une piste à partir de ses valeurs base (fichier) et MusicBrainz (overlay). */
export function initTrackReview(
  track: LocalTrack,
  base: TagBackup,
  mb: MbTags | null
): TrackReview {
  const fields = {} as Record<FieldKey, FieldState>;
  for (const key of ALL_FIELDS) {
    fields[key] = { source: defaultSource(base, mb, key), manual: '' };
  }
  // Artiste effectif ≠ tag fichier (override de suppression d'artiste #12, ou tag re-gravé depuis
  // la sauvegarde) : on le pré-remplit en « Perso » pour que la revue montre — et grave — la
  // valeur corrigée au lieu de faire ressusciter l'ancien tag (limitation historique levée, lot 9).
  const effectiveArtist = track.artist ?? '';
  if (hasValue(effectiveArtist) && effectiveArtist !== (base.artist ?? '')) {
    fields.artist = { source: 'manual', manual: effectiveArtist };
  }
  return {
    trackId: track.id,
    filename: track.filename,
    base,
    mb,
    fields,
    cover: 'keep',
    hasRemoteCover: hasValue(track.coverArtUrl),
  };
}

/** Représentation **affichable** de la valeur active d'un champ (chaîne vide si absente). */
export function displayValue(review: TrackReview, key: FieldKey): string {
  const raw = rawFor(review, key, review.fields[key].source);
  if (raw === null || raw === undefined) {
    return '';
  }
  return typeof raw === 'number' ? String(raw) : raw;
}

/** Parse un numéro de piste/disque saisi : entier ≥ 0, sinon `null` (champ non gravé). */
function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const IS_NUMBER = new Set<FieldKey>(NUMBER_FIELDS);

/** Valeur **finale** d'un champ, telle qu'elle sera gravée (texte → string|null, n° → number|null). */
function resolveField(review: TrackReview, key: FieldKey): string | number | null {
  const raw = rawFor(review, key, review.fields[key].source);
  if (IS_NUMBER.has(key)) {
    return typeof raw === 'number' ? raw : parseNumber(typeof raw === 'string' ? raw : '');
  }
  if (typeof raw === 'number') {
    return String(raw);
  }
  const text = (raw ?? '').trim();
  return text.length > 0 ? text : null;
}

/** Construit le jeu de tags final à graver depuis l'état de revue d'une piste. */
export function reviewToTags(review: TrackReview): TagBackup {
  return {
    title: resolveField(review, 'title') as string | null,
    artist: resolveField(review, 'artist') as string | null,
    album: resolveField(review, 'album') as string | null,
    albumArtist: resolveField(review, 'albumArtist') as string | null,
    trackNo: resolveField(review, 'trackNo') as number | null,
    discNo: resolveField(review, 'discNo') as number | null,
  };
}

/** Change la source d'un champ (immuable). Sur passage en « perso », amorce la saisie avec l'actuel. */
export function setFieldSource(
  review: TrackReview,
  key: FieldKey,
  source: FieldSource
): TrackReview {
  const manual = source === 'manual' ? displayValue(review, key) : review.fields[key].manual;
  return {
    ...review,
    fields: { ...review.fields, [key]: { source, manual } },
  };
}

/** Enregistre une saisie manuelle sur un champ (bascule sa source sur « perso »). */
export function setFieldManual(review: TrackReview, key: FieldKey, text: string): TrackReview {
  return {
    ...review,
    fields: { ...review.fields, [key]: { source: 'manual', manual: text } },
  };
}

/** Change le choix de pochette. */
export function setCover(review: TrackReview, cover: CoverChoice): TrackReview {
  return { ...review, cover };
}

/** Libellés FR des champs (affichage du résumé de changements). */
export const FIELD_LABELS: Record<FieldKey, string> = {
  title: 'Titre',
  artist: 'Artiste',
  album: 'Album',
  albumArtist: 'Artiste d’album',
  trackNo: 'N° piste',
  discNo: 'N° disque',
};

export type FieldChange = {
  key: FieldKey;
  label: string;
  /** Valeur actuelle du tag fichier (affichable, '∅' si absente). */
  from: string;
  /** Valeur qui sera gravée (affichable, '∅' si le champ sera vidé). */
  to: string;
};

const EMPTY_MARK = '∅';

function displayable(v: string | number | null): string {
  if (v === null || (typeof v === 'string' && v.trim().length === 0)) {
    return EMPTY_MARK;
  }
  return String(v);
}

/**
 * Champs dont la valeur **gravée** différera du tag fichier actuel : c'est le résumé qu'on montre
 * sur la carte repliée du mode lot (revue rapide : on ne déplie que ce qui surprend). La pochette
 * n'est pas un champ texte, l'appelant la traite à part via `review.cover`.
 */
export function reviewChanges(review: TrackReview): FieldChange[] {
  // Vide (null / chaîne blanche) replié sur null : « pas de tag » et « tag vide » sont équivalents.
  const norm = (v: string | number | null) =>
    v === null ? null : typeof v === 'number' ? v : v.trim() || null;
  const changes: FieldChange[] = [];
  for (const key of ALL_FIELDS) {
    const before = review.base[key] ?? null;
    const after = resolveField(review, key);
    if (norm(before) !== norm(after)) {
      changes.push({
        key,
        label: FIELD_LABELS[key],
        from: displayable(before),
        to: displayable(after),
      });
    }
  }
  return changes;
}

/**
 * Force la source de **tous les champs éligibles** (raccourci du mode lot : « tout en MusicBrainz »,
 * « tout au fichier »). Un champ dont la source cible n'a pas de valeur retombe sur le fichier (on
 * ne bascule pas un champ sur un MusicBrainz vide). La **pochette** suit le même raccourci :
 * « tout MusicBrainz » = pochette distante quand elle existe, « tout au fichier » = garder celle
 * du fichier.
 */
export function setAllSources(review: TrackReview, source: 'file' | 'mb'): TrackReview {
  const fields = {} as Record<FieldKey, FieldState>;
  for (const key of ALL_FIELDS) {
    const canMb = source === 'mb' && review.mb && hasValue(review.mb[key]);
    fields[key] = { source: canMb ? 'mb' : 'file', manual: review.fields[key].manual };
  }
  const cover: CoverChoice = source === 'mb' && review.hasRemoteCover ? 'remote' : 'keep';
  return { ...review, fields, cover };
}
