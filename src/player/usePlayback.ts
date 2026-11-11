import { RepeatMode, useIsPlaying, useProgress, type MediaItem } from '@rntp/player';

import { useQueue, type QueueState } from './PlayerProvider';

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
 * mini-lecteur et écran Lecture affichent toujours le même titre, et que le surlignage de la file
 * reste cohérent avec l'index actif.
 *
 * ⚠️ Re-rend 4×/s (sondage de la position) : à réserver aux composants qui affichent la
 * progression. Ailleurs, préférer `useActiveTrack`.
 */
export function usePlayback(): PlaybackState {
  const track = useActiveTrack();
  const playing = useIsPlaying();
  const { position, duration } = usePlaybackProgress();

  return {
    track,
    isPlaying: playing,
    position,
    duration,
  };
}

/**
 * Position et durée (secondes) de la piste en cours.
 *
 * Tant que la file affichée est la session restaurée (pas encore chargée dans le lecteur natif),
 * le natif ne connaît ni l'une ni l'autre : on sert alors la position de reprise et la durée lue
 * au scan, pour que la barre de progression montre déjà où la lecture reprendra.
 */
export function usePlaybackProgress(intervalSeconds = 0.25): {
  position: number;
  duration: number;
} {
  const native = useProgress(intervalSeconds);
  const { tracks, activeIndex, restoredPositionMs } = useQueue();
  if (restoredPositionMs !== null) {
    const duration = activeIndex != null ? (tracks[activeIndex]?.duration ?? 0) : 0;
    return { position: restoredPositionMs / 1000, duration };
  }
  return native;
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

/**
 * Index de la piste voisine dans la file (`+1` suivante, `-1` précédente), ou `null` s'il n'y en a
 * pas. La file ne boucle que si la répétition porte sur toute la file : en mode « Off » ou
 * « Piste », la dernière piste n'a pas de suivante et la première pas de précédente.
 *
 * Sert au carrousel du lecteur, qui doit savoir **avant** le geste s'il y a quelque chose à faire
 * entrer : il saute ensuite explicitement à cet index plutôt que de passer par le « précédent »
 * du lecteur, qui redémarre la piste en cours au-delà de 3 s au lieu de reculer.
 */
export function neighborIndex(
  queue: QueueState,
  repeatMode: RepeatMode,
  direction: 1 | -1
): number | null {
  const { tracks, activeIndex } = queue;
  if (activeIndex == null || tracks.length === 0) {
    return null;
  }
  const target = activeIndex + direction;
  if (target >= 0 && target < tracks.length) {
    return target;
  }
  if (repeatMode !== RepeatMode.All || tracks.length < 2) {
    return null;
  }
  return target < 0 ? tracks.length - 1 : 0;
}
