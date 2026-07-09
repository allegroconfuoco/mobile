import TrackPlayer from 'react-native-track-player';

/** Au-delà de ce seuil, « précédent » redémarre la piste courante au lieu de reculer. */
const RESTART_THRESHOLD_S = 3;

/**
 * « Précédent » intelligent, comportement standard des lecteurs : si la piste courante a joué
 * plus de quelques secondes, on la redémarre ; sinon on recule vraiment. Partagé entre l'UI
 * (`PlayerProvider`) et les commandes distantes (notification/Bluetooth, `service.ts`).
 */
export async function smartPrevious(): Promise<void> {
  const { position } = await TrackPlayer.getProgress();
  if (position > RESTART_THRESHOLD_S) {
    await TrackPlayer.seekTo(0);
    return;
  }
  await TrackPlayer.skipToPrevious();
}
