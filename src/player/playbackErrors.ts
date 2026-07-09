/**
 * Relais des erreurs de lecture entre le service RNTP (qui les reçoit, y compris en
 * arrière-plan) et l'UI (qui ne peut les montrer qu'au premier plan). Le service et l'app
 * partagent le même runtime JS, un état de module suffit : le service pousse, l'UI s'abonne
 * et affiche un toast quand elle est là.
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
