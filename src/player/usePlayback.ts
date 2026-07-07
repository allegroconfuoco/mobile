import { useIsPlaying, useProgress, type Track } from 'react-native-track-player';

import { useQueue } from './PlayerProvider';

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
 * La **piste active** est lue depuis le snapshot partagé de la file (`useQueue`, unique instance
 * dans `PlayerProvider`, resynchronisé sur `Event.PlaybackActiveTrackChanged`) plutôt que via
 * `useActiveTrack` : ce dernier maintient un état LOCAL par composant (basé sur `event.track`, sans
 * re-lecture de la source native), si bien que deux consommateurs — mini-player et écran Lecture —
 * pouvaient afficher deux titres différents dès qu'une instance ratait un événement (transition de
 * modal, retour d'arrière-plan). Une source unique élimine toute divergence possible.
 *
 * `useProgress` (position, 250 ms) et `useIsPlaying` restent par composant mais s'auto-corrigent
 * (sondage / re-lecture native), donc sans risque de divergence persistante.
 */
export function usePlayback(): PlaybackState {
  const { tracks, activeIndex } = useQueue();
  const track = activeIndex != null ? tracks[activeIndex] : undefined;
  const { playing } = useIsPlaying();
  const { position, duration } = useProgress(250);

  return {
    track,
    isPlaying: Boolean(playing),
    position,
    duration,
  };
}
