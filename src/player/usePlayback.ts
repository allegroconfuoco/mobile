import { useIsPlaying, useProgress, type MediaItem } from '@rntp/player';

import { useQueue } from './PlayerProvider';

/** Instantané réactif de l'état de lecture, prêt pour l'UI. */
export type PlaybackState = {
  /** Piste en cours, ou `undefined` si la file est vide. */
  track: MediaItem | undefined;
  isPlaying: boolean;
  /** Position et durée en secondes. */
  position: number;
  duration: number;
};

/**
 * Expose l'état de lecture à l'UI.
 *
 * La **piste active** est lue depuis le snapshot partagé de la file (`useQueue`, unique instance
 * dans `PlayerProvider`) plutôt que via `useActiveMediaItem` : une source unique garantit que
 * mini-player et écran Lecture affichent toujours le même titre, et que le surlignage de la file
 * reste cohérent avec l'index actif.
 *
 * `useProgress` (position, sondage 250 ms) et `useIsPlaying` restent par composant mais
 * s'auto-corrigent (lecture native synchrone + resync au retour au premier plan).
 */
export function usePlayback(): PlaybackState {
  const track = useActiveTrack();
  const playing = useIsPlaying();
  const { position, duration } = useProgress(0.25);

  return {
    track,
    isPlaying: playing,
    position,
    duration,
  };
}

/**
 * Piste active seule, sans position ni état de lecture.
 *
 * À préférer à `usePlayback` partout où seul l'id actif compte (surlignage de la ligne en cours
 * dans les listes) : `useProgress` pose un **nouvel objet d'état à chaque tick de 250 ms, même en
 * pause**, donc chaque consommateur de `usePlayback` re-rend 4×/s en continu. Ce hook ne re-rend
 * que quand le snapshot de la file change réellement (changement de piste, mutation de file).
 */
export function useActiveTrack(): MediaItem | undefined {
  const { tracks, activeIndex } = useQueue();
  return activeIndex != null ? tracks[activeIndex] : undefined;
}
