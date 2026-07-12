/**
 * Relais des erreurs de lecture entre le dispatch des événements lecteur (`playerEvents.ts`,
 * qui les reçoit y compris en arrière-plan via le handler headless) et l'UI (qui ne peut les
 * montrer qu'au premier plan). Les deux partagent le même runtime JS, un état de module
 * suffit : le dispatch pousse, l'UI s'abonne et affiche un toast quand elle est là.
 */

export type PlaybackErrorInfo = {
  /** Message présentable (le détail technique part en console côté service). */
  message: string;
  at: number;
};

type Listener = (error: PlaybackErrorInfo) => void;

const listeners = new Set<Listener>();
let last: PlaybackErrorInfo | null = null;

export function notifyPlaybackError(message: string): void {
  last = { message, at: Date.now() };
  for (const listener of listeners) {
    listener(last);
  }
}

/** Dernière erreur émise (pour un abonné monté après coup), ou `null`. */
export function getLastPlaybackError(): PlaybackErrorInfo | null {
  return last;
}

export function subscribePlaybackError(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
