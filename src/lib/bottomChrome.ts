/**
 * Hauteur mesurée du « chrome » bas de l'app (mini-player + inset système), rapportée par le
 * conteneur du mini-player dans `(app)/_layout.tsx` via `onLayout`. Sert au toast (posé juste
 * au-dessus) : mesurer vaut mieux que des constantes de hauteur, le chrome variant avec l'inset
 * et la présence du mini-player.
 */

type Listener = (height: number) => void;

let height = 0;
const listeners = new Set<Listener>();

export function reportBottomChromeHeight(next: number): void {
  if (next === height) {
    return;
  }
  height = next;
  for (const listener of listeners) {
    listener(height);
  }
}

export function getBottomChromeHeight(): number {
  return height;
}

export function subscribeBottomChromeHeight(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
