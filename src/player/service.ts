import TrackPlayer, { Event } from 'react-native-track-player';

/**
 * Service de lecture (headless) de react-native-track-player.
 *
 * Enregistré au démarrage via `TrackPlayer.registerPlaybackService` (voir `index.js`).
 * Il tourne dans une tâche JS séparée, y compris quand l'app est en arrière-plan ou fermée,
 * et relaie les commandes venues de l'extérieur de l'UI : notification média, écran verrouillé,
 * écouteurs Bluetooth. On se contente ici de rebrancher chaque commande distante sur l'API
 * du lecteur ; l'état réactif pour l'UI vit ailleurs (`usePlayback`).
 */
export async function PlaybackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => TrackPlayer.seekTo(position));
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.reset());
}
