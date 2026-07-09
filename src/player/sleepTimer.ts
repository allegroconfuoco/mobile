import TrackPlayer from 'react-native-track-player';

/**
 * Minuteur de sommeil (lot 7 de l'audit).
 *
 * Une **échéance timestamp** en état de module, vérifiée par le service RNTP sur chaque tick de
 * progression (`Event.PlaybackProgressUpdated`, déjà émis toutes les secondes) : le service vit
 * en arrière-plan grâce au foreground service, là où un `setTimeout` long serait throttlé par
 * Android (Doze). L'UI s'abonne pour afficher le compte à rebours — même motif de store que
 * `playbackErrors`/`Toast`.
 */

export type SleepTimerState =
  | { mode: 'off' }
  /** Pause à l'échéance (timestamp ms). */
  | { mode: 'deadline'; endAt: number }
  /** Pause au prochain changement de piste (fin de la piste en cours — un skip manuel compte). */
  | { mode: 'end-of-track' };

type Listener = (state: SleepTimerState) => void;

let state: SleepTimerState = { mode: 'off' };
const listeners = new Set<Listener>();

function set(next: SleepTimerState): void {
  state = next;
  for (const listener of listeners) {
    listener(state);
  }
}

export function getSleepTimer(): SleepTimerState {
  return state;
}

export function subscribeSleepTimer(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Arme le minuteur : pause dans `minutes` minutes. Remplace tout minuteur en cours. */
export function startSleepTimer(minutes: number): void {
  set({ mode: 'deadline', endAt: Date.now() + minutes * 60_000 });
}

/** Arme le mode « fin de la piste » : pause au prochain changement de piste. */
export function sleepAtEndOfTrack(): void {
  set({ mode: 'end-of-track' });
}

export function clearSleepTimer(): void {
  set({ mode: 'off' });
}

/** Appelé par le service à chaque tick de progression : coupe la lecture à l'échéance. */
export async function checkSleepTimer(): Promise<void> {
  if (state.mode === 'deadline' && Date.now() >= state.endAt) {
    set({ mode: 'off' });
    await TrackPlayer.pause().catch(() => {});
  }
}

/** Appelé par le service au changement de piste active (mode « fin de la piste »). */
export async function sleepTimerOnTrackChanged(): Promise<void> {
  if (state.mode === 'end-of-track') {
    set({ mode: 'off' });
    await TrackPlayer.pause().catch(() => {});
  }
}
