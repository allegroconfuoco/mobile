import { useActiveTrack, useIsPlaying, useProgress, type Track } from 'react-native-track-player';

/** Instantané réactif de l'état de lecture, prêt pour l'UI. */
export type PlaybackState = {
  /** Piste en cours, ou `undefined` si la file est vide. */
  track: Track | undefined;
  isPlaying: boolean;
  /** Position et durée en secondes. */
  position: number;
  duration: number;
};

/**
 * Expose l'état de lecture à l'UI.
 *
 * Simple agrégat des hooks de react-native-track-player : chacun s'abonne aux événements du
 * lecteur et re-rend le composant qui l'utilise. `useProgress` interroge la position à
 * intervalle régulier (250 ms) pour animer la barre de progression sans surcharger.
 */
export function usePlayback(): PlaybackState {
  const track = useActiveTrack();
  const { playing } = useIsPlaying();
  const { position, duration } = useProgress(250);

  return {
    track,
    isPlaying: Boolean(playing),
    position,
    duration,
  };
}
