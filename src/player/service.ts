import TrackPlayer, { Event, State } from 'react-native-track-player';

import { smartPrevious } from './controls';
import { notifyPlaybackError } from './playbackErrors';
import {
  recorderOnPause,
  recorderOnProgressTick,
  recorderOnQueueEnded,
  recorderOnTrackChanged,
} from './playRecorder';
import { checkSleepTimer, sleepTimerOnTrackChanged } from './sleepTimer';

/**
 * Service de lecture (headless) de react-native-track-player.
 *
 * Enregistré au démarrage via `TrackPlayer.registerPlaybackService` (voir `index.js`).
 * Il tourne dans une tâche JS séparée, y compris quand l'app est en arrière-plan ou fermée,
 * et relaie les commandes venues de l'extérieur de l'UI : notification média, écran verrouillé,
 * écouteurs Bluetooth. On se contente ici de rebrancher chaque commande distante sur l'API
 * du lecteur ; l'état réactif pour l'UI vit ailleurs (`usePlayback`).
 *
 * Il gère aussi `PlaybackError` (fichier corrompu/déplacé) car c'est le seul endroit garanti
 * vivant en arrière-plan : on saute la piste fautive pour ne pas figer la lecture.
 */

// Garde anti-boucle : en RepeatMode.Queue, une file entièrement illisible ferait skip à
// l'infini (chaque skip re-déclenchant une erreur). Le compteur se remet à zéro dès qu'une
// piste joue vraiment ; au-delà du seuil on arrête d'insister.
const MAX_CONSECUTIVE_ERRORS = 5;
let consecutiveErrors = 0;

export async function PlaybackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => void smartPrevious().catch(() => {}));
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => TrackPlayer.seekTo(position));
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.reset());

  TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
    if (state === State.Playing) {
      consecutiveErrors = 0;
    }
    // Historique d'écoute (#25) : une pause/arrêt écrit la session en cours sans la clore (une
    // reprise cumulera sur la même ligne). Couvre aussi un kill de l'app pendant une pause :
    // l'écoute déjà faite est en base.
    if (state === State.Paused || state === State.Stopped) {
      recorderOnPause();
    }
  });

  // Minuteur de sommeil : vérifié ici (le service vit en arrière-plan, un setTimeout long serait
  // throttlé). Le tick de progression est déjà émis toutes les secondes (`setup.ts`) ; le même
  // tick alimente le temps écouté de l'historique (#25).
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ duration, position }) => {
    recorderOnProgressTick(duration, position);
    void checkSleepTimer();
  });
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
    recorderOnTrackChanged(track);
    void sleepTimerOnTrackChanged();
  });
  // Fin de file (hors répétition) : rien ne suivra, on clôt la session d'écoute (#25).
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => recorderOnQueueEnded());

  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    console.warn('[player] erreur de lecture', e);
    notifyPlaybackError('Lecture impossible, piste ignorée');
    consecutiveErrors += 1;
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      return;
    }
    // Piste illisible : on passe à la suivante pour ne pas bloquer la file. En fin de file
    // (hors répétition), `skipToNext` rejette : rien d'autre à faire, la lecture s'arrête là.
    void TrackPlayer.skipToNext()
      .then(() => TrackPlayer.play())
      .catch(() => {});
  });
}
