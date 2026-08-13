/**
 * Appel de l'endpoint de synchro playlists (issue #17).
 *
 * Un seul aller-retour : `POST /api/sync/playlists` upsert ce qu'on pousse *puis* renvoie le delta
 * depuis `since` dans la même réponse. Nécessite le JWT (firewall `IS_AUTHENTICATED_FULLY`).
 *
 * Même conventions d'erreur que `src/api/auth.ts` : `ApiError` porteur du code HTTP, `status:0`
 * pour une panne réseau (serveur injoignable) — c'est ce que le moteur de synchro interprète comme
 * « hors-ligne, on retentera » sans dépendance réseau supplémentaire (pas de netinfo).
 */
import { ApiError } from '@/api/auth';
import { apiUrl } from '@/api/config';
import type { PlaySyncRequest, PlaySyncResponse, SyncRequest, SyncResponse } from './syncTypes';

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' } as const;

/** POST JSON authentifié vers un endpoint de synchro. Lève `ApiError` (0 = réseau, sinon HTTP). */
async function postSync(token: string, path: string, request: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify(request),
    });
  } catch {
    throw new ApiError(0, 'Impossible de joindre le serveur. Vérifie ta connexion.');
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Échec de la synchronisation (${response.status}).`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object') {
    throw new ApiError(0, 'Réponse de synchro inattendue.');
  }
  return body;
}

/** POST /api/sync/playlists avec le Bearer JWT. */
export async function postPlaylistSync(token: string, request: SyncRequest): Promise<SyncResponse> {
  return (await postSync(token, '/api/sync/playlists', request)) as SyncResponse;
}

/** POST /api/sync/plays (historique d'écoute, issue #25) avec le Bearer JWT. */
export async function postPlaySync(
  token: string,
  request: PlaySyncRequest
): Promise<PlaySyncResponse> {
  return (await postSync(token, '/api/sync/plays', request)) as PlaySyncResponse;
}
