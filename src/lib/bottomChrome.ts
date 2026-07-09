/**
 * Hauteur mesurée du « chrome » bas de l'app (mini-player + tab bar + inset système), rapportée
 * par `ForgeTabBar` via `onLayout`. Sert au toast (posé juste au-dessus) : mesurer vaut mieux
 * que des constantes de hauteur, la barre variant avec l'inset et la présence du mini-player.
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
