/**
 * Moteur de synchro de l'historique d'écoute (issue #25) — même squelette que `syncEngine.ts`
 * (playlists) : un aller-retour, push des événements `dirty` + stubs de pistes, application du
 * delta (LWW horloge serveur), curseur dédié (`plays_cursor`).
 *
 * Ne pousse plus l'état de lecture courant : le handoff inter-appareils a été retiré, la reprise
 * est désormais purement locale (`player/resumeState.ts`).
 *
 * Robustesse : hors-ligne (`ApiError.status === 0`) → rien n'est perdu, on retentera ; clear des
 * `dirty` gardé par le jeton `(playedMs, deletedAt)` (une session re-flushée pendant le `fetch`
 * reste dirty et repartira). La gestion multi-comptes (`user_id` + wipe) est faite par la sync
 * playlists, toujours exécutée en premier par `SyncProvider`.
 */
import { ApiError } from '@/api/auth';

import * as db from '@/library/db';
import type { SyncResult } from './syncEngine';
import { postPlaySync } from './syncApi';
import type { PlayEventPush, PlaySyncRequest } from './syncTypes';

function toEventPush(e: db.DirtyPlayEvent): PlayEventPush {
  return {
    id: e.id,
    trackId: e.sharedTrackId,
    title: e.title,
    artist: e.artist,
    album: e.album,
    startedAt: e.startedAt,
    playedMs: e.playedMs,
    durationMs: e.durationMs,
    skipped: e.skipped,
    completed: e.completed,
    context: e.context,
    deleted: e.deletedAt !== null,
  };
}

/**
 * Exécute une passe de synchro de l'historique. `getAccessToken` renvoie un JWT valide (refresh
 * transparent) ou `null` si la session est tombée (→ `skipped`).
 */
export async function runPlaySync(
  getAccessToken: () => Promise<string | null>
): Promise<SyncResult> {
  const token = await getAccessToken();
  if (!token) {
    return 'skipped';
  }

  // Snapshot des événements à pousser (+ stubs des pistes qu'ils référencent).
  const dirtyEvents = db.loadDirtyPlayEvents();
  const sharedIds = [...new Set(dirtyEvents.map((e) => e.sharedTrackId))];
  const stubs = db.loadTrackStubs(sharedIds);

  const request: PlaySyncRequest = {
    since: db.getSyncState('plays_cursor'),
    tracks: stubs.map((s) => ({
      id: s.sharedId,
      ...(s.title !== null ? { title: s.title } : {}),
      ...(s.artist !== null ? { artist: s.artist } : {}),
      ...(s.mbid !== null ? { mbid: s.mbid } : {}),
    })),
    events: dirtyEvents.map(toEventPush),
  };
  let response;
  try {
    response = await postPlaySync(token, request);
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      return 'offline';
    }
    return 'error';
  }

  // Applique le delta (les événements encore `dirty` sont préservés), avance le curseur, puis
  // efface les `dirty` poussés qui n'ont pas rebougé entre-temps.
  db.applyPlaysServerDelta(response.tracks ?? [], response.events ?? []);
  db.setSyncState('plays_cursor', response.serverTime);
  for (const e of dirtyEvents) {
    db.clearPlayEventDirty(e.id, e.playedMs, e.deletedAt);
  }

  return 'ok';
}
