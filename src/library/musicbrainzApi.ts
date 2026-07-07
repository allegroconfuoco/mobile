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

  const result = (body as { result?: unknown } | null)?.result ?? null;
  if (!result || typeof result !== 'object') {
    return null;
  }
  const r = result as Record<string, unknown>;
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
