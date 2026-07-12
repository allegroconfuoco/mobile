import TrackPlayer, { Event, PlaybackState, type BackgroundEvent } from '@rntp/player';

import { notifyPlaybackError } from './playbackErrors';
import {
  recorderOnPause,
  recorderOnProgressTick,
  recorderOnQueueEnded,
  recorderOnResume,
  recorderOnTrackChanged,
} from './playRecorder';

/**
 * Dispatch des événements du lecteur (@rntp/player v5), partagé entre les deux canaux :
 *
 * - **premier plan** : `addEventListener` (câblé une fois par `wireForegroundPlayerEvents`,
 *   appelé au setup) ;
 * - **arrière-plan** : le handler headless Android (`registerBackgroundEventHandler`, cf.
 *   `index.js`) — le natif route chaque événement vers UN des deux canaux selon l'état de l'app,
 *   jamais les deux, donc aucun double comptage.
 *
 * Y transitent l'historique d'écoute (#25, via `playRecorder`) et la gestion des erreurs de
 * lecture (skip automatique). Les commandes distantes (notification/Bluetooth) et le minuteur de
 * sommeil sont désormais gérés nativement : plus aucun relais JS.
 */

// Garde anti-boucle : en répétition de file, une file entièrement illisible ferait skip à
// l'infini (chaque skip re-déclenchant une erreur). Le compteur se remet à zéro dès qu'une
// piste joue vraiment ; au-delà du seuil on arrête d'insister.
const MAX_CONSECUTIVE_ERRORS = 5;
let consecutiveErrors = 0;

/** Traite un événement du lecteur, d'où qu'il vienne (premier plan ou headless). */
export function dispatchPlayerEvent(event: BackgroundEvent): void {
  switch (event.type) {
    case Event.MediaItemTransition:
      recorderOnTrackChanged(event.item ?? undefined);
      break;

    // Tick 1 s (émis en lecture seulement, + un tick final à la pause) : temps écouté + position.
    case Event.PlaybackProgressUpdated:
      recorderOnProgressTick(event.duration, event.position);
      break;

    case Event.IsPlayingChanged:
      if (event.playing) {
        consecutiveErrors = 0;
        recorderOnResume();
      } else {
        // Pause/arrêt : écrit la session en cours sans la clore (une reprise cumulera sur la
        // même ligne). Couvre aussi un kill de l'app pendant une pause.
        recorderOnPause();
      }
      break;

    // Fin de file (hors répétition) : rien ne suivra, on clôt la session d'écoute (#25).
    case Event.PlaybackStateChanged:
      if (event.state === PlaybackState.Ended) {
        recorderOnQueueEnded();
      }
      break;

    case Event.PlaybackError: {
      console.warn('[player] erreur de lecture', event.code, event.message);
      notifyPlaybackError('Lecture impossible, piste ignorée');
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return;
      }
      // Piste illisible : on passe à la suivante pour ne pas bloquer la file. En fin de file
      // (hors répétition), le skip est sans effet : la lecture s'arrête là.
      TrackPlayer.skipToNext();
      TrackPlayer.play();
      break;
    }
  }
}

let wired = false;

/**
 * Abonne le dispatch aux événements côté premier plan. Idempotent (rechargement à chaud) ;
 * les abonnements vivent aussi longtemps que le runtime, comme le service RNTP d'avant.
 */
export function wireForegroundPlayerEvents(): void {
  if (wired) {
    return;
  }
  wired = true;

  TrackPlayer.addEventListener(Event.MediaItemTransition, (e) =>
    dispatchPlayerEvent({ type: Event.MediaItemTransition, ...e })
  );
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (e) =>
    dispatchPlayerEvent({ type: Event.PlaybackProgressUpdated, ...e })
  );
  TrackPlayer.addEventListener(Event.IsPlayingChanged, (e) =>
    dispatchPlayerEvent({ type: Event.IsPlayingChanged, ...e })
  );
  TrackPlayer.addEventListener(Event.PlaybackStateChanged, (e) =>
    dispatchPlayerEvent({ type: Event.PlaybackStateChanged, ...e })
  );
  TrackPlayer.addEventListener(Event.PlaybackError, (e) =>
    dispatchPlayerEvent({ type: Event.PlaybackError, ...e })
  );
}
