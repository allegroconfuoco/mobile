/**
 * Construction de la requête MusicBrainz (issue #18) — pur JS, aucune IO.
 *
 * Enrichissement « niveau 1 » de PROJET.md : à partir d'une piste locale, produire un couple
 * artiste + titre propre à envoyer au proxy backend (`GET /api/musicbrainz/resolve` exige les
 * deux champs, `GET /api/musicbrainz/search` accepte l'un ou l'autre). L'appel réseau lui-même
 * est l'issue #19 ; ici on ne fait que préparer des termes de recherche exploitables.
 *
 * Deux sources, dans l'ordre :
 * 1. **Tags ID3** (déjà lus au scan et persistés sur `LocalTrack`) — mais même taggés, les
 *    fichiers téléchargés charrient du bruit (« Titre (Official Video) ») qu'on nettoie.
 * 2. **Nom de fichier** en repli : motif « Artiste - Titre.mp3 » et variantes (underscores,
 *    numéro de piste en tête, préfixe de site de téléchargement, segments multiples).
 *
 * La normalisation reste volontairement **basique** et lisible : on retire ce qui est
 * clairement du bruit, on ne réécrit pas les titres. Et on garde casse + accents : la
 * recherche MusicBrainz s'en accommode, et c'est ce qu'on réaffichera à l'utilisateur dans
 * l'UI de correction (issue #20). Le repli minuscule/sans accent existe déjà mais sert à
 * autre chose (clé de rapprochement inter-appareils, `computeMatchKey` dans `db.ts`).
 */

/** Termes de recherche prêts à être envoyés au proxy MusicBrainz. */
export type MatchQuery = {
  /** Artiste nettoyé, ou `null` si introuvable (tags absents et nom de fichier sans motif). */
  artist: string | null;
  /** Titre nettoyé, jamais vide. */
  title: string;
  /**
   * Provenance des champs : `tags` (tout vient des tags ID3), `filename` (tout vient du nom
   * de fichier), `mixed` (titre taggé, artiste déduit du nom de fichier). Sert à pondérer la
   * confiance du match côté UI de correction (issue #20).
   */
  source: 'tags' | 'filename' | 'mixed';
};

/** Le strict nécessaire d'une `LocalTrack` (évite d'importer le type du hook ici). */
export type MatchQueryInput = {
  /** Titre affiché : tag ID3 s'il existe, sinon nom de fichier sans extension. */
  title: string;
  /** Artiste (tag ID3), ou `null`. */
  artist: string | null;
  /** Nom de fichier complet, extension comprise. */
  filename: string;
};

// --- Nettoyage commun (tags comme nom de fichier) ---

/**
 * Contenus de parenthèses/crochets qui sont du bruit de téléchargement, pas du titre :
 * on ne retire un segment entre (), [] ou {} que si son contenu matche l'un de ces mots.
 * « (Extended Mix) » ou « (Acoustic) » sont souvent de vrais titres MusicBrainz : on n'y
 * touche pas.
 */
const NOISE_WORDS =
  /\b(official|video|audio|lyrics?|paroles|clip|visuali[sz]er|hd|hq|4k|explicit|remaster(?:ed)?|full album|videoclip|official music video)\b/i;

/** Segment entre parenthèses/crochets/accolades, sans imbrication. */
const BRACKET_SEGMENT = /\s*[([{]([^()[\]{}]*)[)\]}]/g;

/**
 * Segment entre parenthèses ne contenant qu'une année (« (2019) », « [2024] », « (© 1998) ») :
 * du bruit de téléchargement, jamais un vrai titre. `NOISE_WORDS` ne le couvre pas (pas de mot),
 * d'où ce test dédié appliqué au contenu déjà extrait des parenthèses.
 */
const YEAR_ONLY = /^(?:©\s*)?(?:19|20)\d{2}$/;

/**
 * Mention « feat./ft./featuring X » en fin de champ, parenthésée ou non. Les frontières de
 * mot sont indispensables : sans elles, « ft » matcherait au milieu de « Daft Punk ».
 */
const FEAT_SUFFIX = /\s*[([{]?\s*\b(?:featuring|feat|ft)\b\.?\s+[^()[\]{}]*[)\]}]?\s*$/i;

/** « - Remastered 2011 » / « – 2011 Remaster » en fin de titre (variante non parenthésée). */
const REMASTER_SUFFIX = /\s*[-–—]\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?\s*$/i;

/** Retire les segments parenthésés dont le contenu est du bruit connu. */
function stripNoiseBrackets(value: string): string {
  return value.replace(BRACKET_SEGMENT, (segment, content: string) =>
    NOISE_WORDS.test(content) || YEAR_ONLY.test(content.trim()) ? '' : segment
  );
}

/** Espaces multiples → un seul, et on rogne les séparateurs orphelins en bord de champ. */
function collapse(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—_.]+|[\s\-–—_.]+$/g, '')
    .trim();
}

/** Nettoyage d'un champ (titre ou artiste), quelle que soit sa provenance. */
function cleanField(value: string): string {
  let out = stripNoiseBrackets(value);
  out = out.replace(FEAT_SUFFIX, '');
  out = out.replace(REMASTER_SUFFIX, '');
  return collapse(out);
}

// --- Parsing du nom de fichier ---

/** Extension audio en fin de nom (on ne coupe pas sur un point interne au titre). */
const AUDIO_EXTENSION = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma|aiff?|alac)$/i;

/** Préfixe « site de téléchargement » : un domaine suivi d'un tiret (« y2mate.com - … »). */
const SITE_PREFIX = /^\s*[\w-]+\.(?:com|net|org|io|cc|to|me)\s*[-–—]\s*/i;

/**
 * Numéro de piste en tête : « 01 - », « 01. », « 1-02 » (disque-piste), éventuellement
 * répété (« 1 - 01 - »). Deux chiffres max par bloc pour ne pas manger un titre-année
 * (« 1999 - Prince ») ni « 24K Magic » (pas de séparateur après « 24 »).
 */
const TRACK_NO_PREFIX = /^\s*(?:\d{1,2}(?:[.)\-_ ]\d{1,2})?[\s.)\-_]+)/;

/** Séparateur artiste/titre : tiret (ou demi-cadratin/cadratin) entouré d'espaces. */
const ARTIST_TITLE_SEPARATOR = /\s+[-–—]\s+/;

/**
 * Tente d'extraire artiste + titre d'un nom de fichier. Retourne des champs déjà nettoyés ;
 * `artist` est `null` si le nom ne contient pas de séparateur exploitable.
 */
export function parseFilename(filename: string): { artist: string | null; title: string } {
  let stem = filename.replace(AUDIO_EXTENSION, '');
  // Convention courante des fichiers sans espaces : « Artiste_-_Titre.mp3 ».
  stem = stem.replace(/_/g, ' ');
  stem = stem.replace(SITE_PREFIX, '');
  stem = stem.replace(TRACK_NO_PREFIX, '');

  const parts = stem
    .split(ARTIST_TITLE_SEPARATOR)
    .map(cleanField)
    .filter((p) => p.length > 0);

  if (parts.length >= 2) {
    // « Artiste - Titre », ou « Artiste - Album - Titre » : le premier segment est
    // l'artiste, le dernier le titre, le milieu (album, n° de piste…) ne nous sert pas.
    return { artist: parts[0], title: parts[parts.length - 1] };
  }
  return { artist: null, title: parts[0] ?? cleanField(stem) };
}

/** Comparaison lâche de deux libellés (casse + espaces ignorés) pour repérer un artiste dupliqué. */
function looseEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/**
 * Certains fichiers téléchargés collent « Artiste - Titre » directement dans le tag Titre (« Red Hot
 * Chili Peppers - Can't Stop ») : envoyé tel quel, MusicBrainz cherche tout le libellé comme titre
 * de morceau et ne trouve rien. Si le titre contient le séparateur artiste/titre, on le scinde :
 *  - artiste connu ET égal au segment de tête → on retire ce préfixe redondant (on garde l'artiste) ;
 *  - artiste inconnu → tête = artiste, queue = titre (même heuristique que le nom de fichier) ;
 *  - artiste connu mais ≠ tête → ambigu (le « - » fait peut-être partie d'un vrai titre), on ne
 *    touche à rien.
 */
function stripEmbeddedArtist(
  title: string,
  artist: string | null
): { title: string; artist: string | null } {
  let parts = title
    .split(ARTIST_TITLE_SEPARATOR)
    .map(cleanField)
    .filter((p) => p.length > 0);
  // Numéro de piste pur collé en tête d'un tag titre (« 1 - Artiste - Titre », « 03 - Titre ») :
  // ce n'est ni un artiste ni un titre. On ne retire QUE des segments **entièrement** numériques
  // (« 1 », « 03 »), donc « 99 Luftballons » ou « 7 rings » (un seul segment, sans séparateur)
  // ne sont jamais touchés. Le chemin nom-de-fichier retire déjà ce préfixe (`TRACK_NO_PREFIX`) ;
  // ici on couvre le cas où le bruit vit dans le tag titre lui-même.
  if (parts.length >= 2 && /^\d{1,2}$/.test(parts[0])) {
    parts = parts.slice(1);
  }
  if (parts.length < 2) {
    return { title: parts[0] ?? title, artist };
  }
  const head = parts[0];
  const tail = parts[parts.length - 1];
  if (artist) {
    return looseEqual(head, artist) ? { title: tail, artist } : { title, artist };
  }
  return { title: tail, artist: head };
}

// --- Point d'entrée ---

/**
 * Construit les termes de recherche MusicBrainz d'une piste locale, ou `null` si rien
 * d'exploitable (même le nom de fichier ne donne aucun titre). Les tags priment ; le nom
 * de fichier comble les trous.
 */
export function buildMatchQuery(track: MatchQueryInput): MatchQuery | null {
  // `LocalTrack.title` vaut déjà « nom de fichier sans extension » quand le tag manque
  // (cf. `toRow` dans `useAudioLibrary.ts`) : dans ce cas le titre n'est pas un vrai tag
  // et doit passer par le parsing du nom de fichier, pas par le nettoyage direct.
  const dot = track.filename.lastIndexOf('.');
  const stem = dot > 0 ? track.filename.slice(0, dot) : track.filename;
  const titleIsTagged = track.title.trim() !== stem.trim();

  const tagTitle = titleIsTagged ? cleanField(track.title) : '';
  const tagArtist = track.artist ? cleanField(track.artist) : '';
  const fromFilename = tagTitle && tagArtist ? null : parseFilename(track.filename);

  const rawTitle = tagTitle || fromFilename?.title || '';
  if (!rawTitle) {
    return null;
  }
  const rawArtist = tagArtist || fromFilename?.artist || null;

  // Nettoie un tag Titre pollué par « Artiste - Titre » (voir `stripEmbeddedArtist`). Le nom de
  // fichier, lui, est déjà scindé par `parseFilename`, donc ce second passage ne le concerne que
  // si le titre retenu vient du tag.
  const { title, artist } = stripEmbeddedArtist(rawTitle, rawArtist);

  const source: MatchQuery['source'] = tagTitle
    ? artist && !tagArtist
      ? 'mixed'
      : 'tags'
    : 'filename';
  return { artist, title, source };
}
