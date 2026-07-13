import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import TrackPlayer from '@rntp/player';

/**
 * Minuteur de sommeil **natif** (@rntp/player v5) : le natif compte et coupe lui-même la lecture,
 * y compris écran éteint (fini le contournement Doze via les ticks du service). Ce hook ne fait
 * que sonder l'état pour l'affichage (compte à rebours), au même rythme que `useProgress` de la
 * lib — la lecture native est impure, donc jamais faite pendant le rendu (react-hooks/purity).
 */

export type SleepTimerInfo =
  | { type: 'time'; remainingSeconds: number; fadeOutSeconds: number }
  | { type: 'mediaItem'; index: number };

function readSleepTimer(): SleepTimerInfo | null {
  if (Platform.OS === 'web') {
    return null;
  }
  return TrackPlayer.getSleepTimer();
}

export function useSleepTimer(): {
  timer: SleepTimerInfo | null;
  /** Arme le minuteur : pause dans `minutes` minutes. Remplace tout minuteur en cours. */
  startAfterMinutes: (minutes: number) => void;
  /** Pause à la fin de la piste en cours (frontière d'élément native). */
  stopAtEndOfTrack: () => void;
  cancel: () => void;
} {
  const [timer, setTimer] = useState<SleepTimerInfo | null>(readSleepTimer);

  // Sondage 1 s : rafraîchit le compte à rebours et capte l'extinction native (déclenchement).
  // `setTimer(null)` quand rien ne change (off → off) ne re-rend pas : setState même valeur.
  useEffect(() => {
    const id = setInterval(() => setTimer(readSleepTimer()), 1000);
    return () => clearInterval(id);
  }, []);

  const startAfterMinutes = useCallback((minutes: number) => {
    TrackPlayer.sleepAfterTime(minutes * 60);
    setTimer(readSleepTimer());
  }, []);

  const stopAtEndOfTrack = useCallback(() => {
    // Sans index : la lib vise la piste active.
    TrackPlayer.sleepAfterMediaItemAtIndex();
    setTimer(readSleepTimer());
  }, []);

  const cancel = useCallback(() => {
    TrackPlayer.cancelSleepTimer();
    setTimer(null);
  }, []);

  return { timer, startAfterMinutes, stopAtEndOfTrack, cancel };
}
