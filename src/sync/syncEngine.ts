/**
 * Moteur de synchro playlists (issue #17) — orchestration pure (pas de React).
 *
 * Un seul aller-retour : on pousse les lignes locales modifiées (`dirty`) et on applique le delta
 * renvoyé (last-write-wins horloge serveur). Stratégie détaillée dans
 * `backend/src/Service/PlaylistSyncService.php` et le CRUD de `src/library/db.ts`.
 *
 * Robustesse :
 *  - **Hors-ligne** (panne réseau `ApiError.status === 0`) : on ne touche ni aux `dirty` ni au
 *    curseur, tout retentera au prochain déclenchement. Aucune dépendance réseau (pas de netinfo).
 *  - **Multi-comptes** : la base `fuoco.db` est partagée ; si le compte a changé, on efface les
 *    données synchronisées avant de repartir de zéro.
 *  - **Édition pendant le `fetch`** : le clear des `dirty` est gardé par `updated_at`, donc une
 *    modif faite en cours de route n'est pas perdue (elle repartira au cycle suivant).
 */
import { ApiError } from '@/api/auth';
import { getTokenSubject } from '@/auth/jwt';
import * as db from '@/library/db';
import { postPlaylistSync } from './syncApi';
import type {
  SyncPlaylistPush,
  SyncPlaylistTrackPush,
  SyncRequest,
  SyncTrackPush,
} from './syncTypes';

/** Issue d'une passe de synchro. */
export type SyncResult = 'ok' | 'offline' | 'skipped' | 'error';

function toTrackPush(stub: db.TrackStub): SyncTrackPush {
  const out: SyncTrackPush = { id: stub.sharedId };
  if (stub.title !== null) {
    out.title = stub.title;
  }
  if (stub.artist !== null) {
    out.artist = stub.artist;
  }
  if (stub.mbid !== null) {
    out.mbid = stub.mbid;
  }
  return out;
}

function toPlaylistPush(p: db.DirtyPlaylist): SyncPlaylistPush {
  return { id: p.id, name: p.name, description: p.description, deleted: p.deletedAt !== null };
}

function toPlaylistTrackPush(pt: db.DirtyPlaylistTrack): SyncPlaylistTrackPush {
  return {
    id: pt.id,
    playlistId: pt.playlistId,
    trackId: pt.sharedTrackId,
    position: pt.position,
    deleted: pt.deletedAt !== null,
  };
}

/**
 * Exécute une passe de synchro. `getAccessToken` renvoie un JWT valide (refresh transparent) ou
 * `null` si la session est tombée (→ `skipped`).
 */
export async function runSync(getAccessToken: () => Promise<string | null>): Promise<SyncResult> {
  const token = await getAccessToken();
  if (!token) {
    return 'skipped';
  }

  // Base locale `fuoco.db` partagée entre comptes. Au *premier* sync (`user_id` non défini) on
  // adopte l'utilisateur courant SANS effacer : les playlists locales rétro-remplies (dirty) doivent
  // encore remonter. On ne repart d'une ardoise vierge que sur un vrai *changement* de compte.
  const subject = getTokenSubject(token);
  if (subject) {
    const storedUser = db.getSyncState('user_id');
    if (storedUser === null) {
      db.setSyncState('user_id', subject);
    } else if (storedUser !== subject) {
      db.wipeSyncData();
      db.setSyncState('user_id', subject);
    }
  }

  // Snapshot des lignes à pousser (+ stubs des pistes qu'elles référencent).
  const dirtyPlaylists = db.loadDirtyPlaylists();
  const dirtyPlaylistTracks = db.loadDirtyPlaylistTracks();
  const sharedIds = [...new Set(dirtyPlaylistTracks.map((pt) => pt.sharedTrackId))];
  const stubs = db.loadTrackStubs(sharedIds);

  const request: SyncRequest = {
    since: db.getSyncState('cursor'),
    tracks: stubs.map(toTrackPush),
    playlists: dirtyPlaylists.map(toPlaylistPush),
    playlistTracks: dirtyPlaylistTracks.map(toPlaylistTrackPush),
  };

  let response;
  try {
    response = await postPlaylistSync(token, request);
  } catch (error) {
    // Réseau injoignable → hors-ligne : on retentera sans rien perdre. Autre erreur → échec.
    if (error instanceof ApiError && error.status === 0) {
      return 'offline';
    }
    return 'error';
  }

  // Applique le delta (les lignes qu'on vient de pousser restent `dirty` et sont donc préservées),
  // avance le curseur, puis efface les `dirty` poussés qui n'ont pas rebougé entre-temps.
  db.applyServerDelta(response);
  db.setSyncState('cursor', response.serverTime);
  for (const p of dirtyPlaylists) {
    db.clearPlaylistDirty(p.id, p.updatedAt);
  }
  for (const pt of dirtyPlaylistTracks) {
    db.clearPlaylistTrackDirty(pt.id, pt.updatedAt);
  }

  return 'ok';
}
