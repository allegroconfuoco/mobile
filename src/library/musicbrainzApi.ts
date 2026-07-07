/**
 * Appel du proxy MusicBrainz du backend (issue #19) — enrichissement « niveau 1 » de PROJET.md.
 *
 * Le backend résout « artiste + titre » → MBID + album + pochette UNE fois et le cache pour tous
 * les users (cf. backend/src/Service/MusicBrainz/MetadataResolver.php). C'est lui qui absorbe le
 * rate limit MusicBrainz (~1 req/s en amont, attente *bloquante* côté serveur, jamais un 429) :
 * un cache miss tient un worker php-fpm jusqu'à ~1 s, un cache hit est instantané. Côté app on se
 * contente d'un GET authentifié et on **sérialise** les appels (cf. `enrichEngine`) pour ne pas
 * empiler les workers.
 *
 * Contrat : GET /api/musicbrainz/resolve?artist=…&title=… (les deux requis, sinon 400) →
 * `{ result: MusicBrainzTrack | null, cached: bool }`. `result` vaut `null` quand MusicBrainz n'a
 * aucun match. Mêmes conventions d'erreur que `syncApi` : `ApiError` porteur du code HTTP,
 * `status:0` = panne réseau (serveur injoignable).
 */
import { ApiError } from '@/api/auth';
import { apiUrl } from '@/api/config';

/** Métadonnées résolues par le proxy (une piste MusicBrainz aplatie). */
export type ResolvedMetadata = {
  mbid: string;
  title: string;
  artist: string | null;
  album: string | null;
  releaseGroupMbid: string | null;
  /** URL Cover Art Archive *construite* (peut renvoyer 404 : l'UI retombe sur un repli). */
  coverArtUrl: string | null;
};

const ACCEPT = { Accept: 'application/json' } as const;

/**
 * Aplati une piste MusicBrainz brute (DTO `MusicBrainzTrack`) en `ResolvedMetadata`, ou `null` si
 * les champs garantis (mbid + titre) manquent. Partagé par `resolve` et `search`.
 */
function parseTrack(value: unknown): ResolvedMetadata | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const r = value as Record<string, unknown>;
  // MBID + titre sont les seuls champs garantis non nuls côté DTO ; sans eux, on ignore.
  if (typeof r.mbid !== 'string' || typeof r.title !== 'string') {
    return null;
  }
  return {
    mbid: r.mbid,
    title: r.title,
    artist: typeof r.artist === 'string' ? r.artist : null,
    album: typeof r.album === 'string' ? r.album : null,
    releaseGroupMbid: typeof r.releaseGroupMbid === 'string' ? r.releaseGroupMbid : null,
    coverArtUrl: typeof r.coverArtUrl === 'string' ? r.coverArtUrl : null,
  };
}

/**
 * Résout artiste + titre en métadonnées MusicBrainz via le proxy backend. Renvoie `null` si aucun
 * match. Lève `ApiError` (0 = réseau, 401 = session, 503 = MusicBrainz throttle/indispo, 5xx = proxy)
 * — le moteur d'enrichissement décide alors d'arrêter la passe et de réessayer plus tard.
 */
export async function resolveMetadata(
  token: string,
  artist: string,
  title: string
): Promise<ResolvedMetadata | null> {
  const query = new URLSearchParams({ artist, title }).toString();
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/musicbrainz/resolve?${query}`), {
      headers: { ...ACCEPT, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0, 'Impossible de joindre le serveur.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Échec de la résolution (${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return parseTrack((body as { result?: unknown } | null)?.result ?? null);
}

/**
 * Recherche de candidats via le proxy de recherche backend — sert à l'UI de correction (#20) quand
 * l'auto-match est faux ou absent. Contrairement à `resolve`, `search` accepte artiste **et/ou**
 * titre (au moins un requis) et renvoie plusieurs pistes classées.
 *
 * Contrat : `GET /api/musicbrainz/search?artist=&title=&limit=` → `{ results: MusicBrainzTrack[] }`.
 * Mêmes conventions d'erreur que `resolveMetadata` (`ApiError`, `status:0` = réseau). Une réponse
 * sans résultat renvoie un tableau vide.
 */
export async function searchMetadata(
  token: string,
  params: { artist?: string; title?: string },
  limit = 8
): Promise<ResolvedMetadata[]> {
  const query = new URLSearchParams();
  const artist = params.artist?.trim();
  const title = params.title?.trim();
  if (artist) {
    query.set('artist', artist);
  }
  if (title) {
    query.set('title', title);
  }
  query.set('limit', String(limit));

  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/musicbrainz/search?${query.toString()}`), {
      headers: { ...ACCEPT, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0, 'Impossible de joindre le serveur.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Échec de la recherche (${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) {
    return [];
  }
  const out: ResolvedMetadata[] = [];
  for (const item of results) {
    const parsed = parseTrack(item);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

// --- Résolution release-level : identification d'album (issue #23, backend #14) --------------

/** Un candidat release renvoyé par `/api/musicbrainz/album-candidates`. */
export type ReleaseCandidate = {
  mbid: string;
  title: string;
  artist: string | null;
  year: number | null;
  trackCount: number | null;
  /** URL Cover Art Archive release-level *construite* (peut 404 : l'UI retombe sur un repli). */
  coverArtUrl: string | null;
  score: number | null;
};

/** Une piste d'une release résolue, dans l'ordre (disque + position). */
export type ReleaseTrack = {
  discNo: number;
  position: number;
  /** Numéro imprimé (« 1 », « A1 »…), conservé tel quel. */
  number: string;
  title: string;
  lengthMs: number | null;
  recordingMbid: string | null;
};

/** Une release résolue avec sa tracklist ordonnée. */
export type Release = {
  mbid: string;
  title: string;
  artist: string | null;
  coverArtUrl: string | null;
  tracks: ReleaseTrack[];
};

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseCandidate(value: unknown): ReleaseCandidate | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const r = value as Record<string, unknown>;
  if (typeof r.mbid !== 'string') {
    return null;
  }
  return {
    mbid: r.mbid,
    title: str(r.title) ?? '',
    artist: str(r.artist),
    year: num(r.year),
    trackCount: num(r.trackCount),
    coverArtUrl: str(r.coverArtUrl),
    score: num(r.score),
  };
}

function parseReleaseTrack(value: unknown): ReleaseTrack | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const r = value as Record<string, unknown>;
  return {
    discNo: num(r.discNo) ?? 1,
    position: num(r.position) ?? 0,
    number: str(r.number) ?? '',
    title: str(r.title) ?? '',
    lengthMs: num(r.lengthMs),
    recordingMbid: str(r.recordingMbid),
  };
}

/**
 * Interroge les candidats release pour un album (`POST /api/musicbrainz/album-candidates`, backend
 * #14). Le backend raisonne par *release* (album original / deluxe / compilation) et renvoie une
 * liste classée. Mêmes conventions d'erreur que `resolveMetadata` (`ApiError`, `status:0` = réseau).
 */
export async function fetchAlbumCandidates(
  token: string,
  params: { albumArtist: string; album: string; trackCount?: number; trackTitles?: string[] }
): Promise<ReleaseCandidate[]> {
  let response: Response;
  try {
    response = await fetch(apiUrl('/api/musicbrainz/album-candidates'), {
      method: 'POST',
      headers: { ...ACCEPT, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        albumArtist: params.albumArtist,
        album: params.album,
        trackCount: params.trackCount,
        trackTitles: params.trackTitles,
      }),
    });
  } catch {
    throw new ApiError(0, 'Impossible de joindre le serveur.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Échec de la recherche d’album (${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const candidates = (body as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates)) {
    return [];
  }
  const out: ReleaseCandidate[] = [];
  for (const item of candidates) {
    const parsed = parseCandidate(item);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

/**
 * Récupère la tracklist ordonnée d'une release (`GET /api/musicbrainz/release/{mbid}`, backend #14).
 * Renvoie `null` si le backend ne connaît pas la release (404). Mêmes conventions d'erreur que
 * `resolveMetadata`.
 */
export async function fetchRelease(token: string, mbid: string): Promise<Release | null> {
  let response: Response;
  try {
    response = await fetch(apiUrl(`/api/musicbrainz/release/${encodeURIComponent(mbid)}`), {
      headers: { ...ACCEPT, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0, 'Impossible de joindre le serveur.');
  }

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new ApiError(response.status, `Échec du chargement de l’album (${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const release = (body as { release?: unknown } | null)?.release;
  if (!release || typeof release !== 'object') {
    return null;
  }
  const r = release as Record<string, unknown>;
  const tracks: ReleaseTrack[] = [];
  if (Array.isArray(r.tracks)) {
    for (const item of r.tracks) {
      const parsed = parseReleaseTrack(item);
      if (parsed) {
        tracks.push(parsed);
      }
    }
  }
  return {
    mbid: str(r.mbid) ?? mbid,
    title: str(r.title) ?? '',
    artist: str(r.artist),
    coverArtUrl: str(r.coverArtUrl),
    tracks,
  };
}
