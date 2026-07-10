import * as db from '@/library/db';
import { uuidv7 } from '@/sync/uuid';

import { createPlayRecorder, type PlayContext } from './playSession';

/**
 * Enregistreur d'écoutes (issue #25) — singleton de module branché dans le service RNTP (seul
 * code garanti vivant en arrière-plan), même motif que `sleepTimer`. Service et UI partagent le
 * même runtime JS, donc ce store est visible des deux côtés.
 *
 * La logique de session vit dans `playSession.ts` (cœur pur, testé au harnais) ; ici on ne fait
 * que câbler les effets réels : horloge, UUIDv7, préférence incognito et écriture en base avec
 * résolution de l'identité **partagée** de la piste (`track_registry`).
 */

export type { PlayContext };

/** Vrai si le mode « écoute privée » est actif (préférence `app_settings`). */
export function isIncognitoEnabled(): boolean {
  return db.getSetting('history.incognito') === '1';
}

/** Active/désactive l'écoute privée. Lu à chaque flush : effet immédiat, même session en cours. */
export function setIncognitoEnabled(enabled: boolean): void {
  db.setSetting('history.incognito', enabled ? '1' : '0');
}

const recorder = createPlayRecorder({
  now: Date.now,
  newId: uuidv7,
  isIncognito: isIncognitoEnabled,
  persist(draft) {
    // Horodatage « dernière activité locale » : la carte Reprendre (handoff) ne se montre que
    // si l'état distant est plus frais que lui.
    db.setSetting('playback.lastLocalAt', String(Date.now()));
    // Résolution de l'identité stable au moment de l'écriture : le registre adopte ou crée
    // l'id partagé de la piste (même clé que la synchro des playlists).
    const sharedTrackId = db.ensureSharedTrackId(draft.localTrackId);
    if (!sharedTrackId) {
      return;
    }
    db.upsertPlayEvent({
      id: draft.eventId,
      sharedTrackId,
      localTrackId: draft.localTrackId,
      title: draft.title,
      artist: draft.artist,
      album: draft.album,
      startedAt: draft.startedAt,
      playedMs: draft.playedMs,
      durationMs: draft.durationMs,
      skipped: draft.skipped,
      completed: draft.completed,
      context: draft.context,
    });
  },
});

/** Contexte du prochain lancement de lecture — appelé par `PlayerProvider.playQueue`. */
export function setPlayContext(context: PlayContext | null): void {
  recorder.setContext(context);
}

/** État de lecture courant (position réelle), poussé au serveur par la sync (handoff). */
export const getPlaybackSnapshot = recorder.getSnapshot;

/** Hooks du service RNTP (voir `service.ts`). */
export const recorderOnTrackChanged = recorder.onTrackChanged;
export const recorderOnProgressTick = recorder.onProgressTick;
export const recorderOnPause = recorder.onPause;
export const recorderOnQueueEnded = recorder.onQueueEnded;
