/**
 * Ouverture du menu latéral (drawer), en store de module — même motif impératif que `showToast`
 * (Toast.tsx) et `reportBottomChromeHeight` (bottomChrome.ts) : appelable depuis n'importe quel
 * bouton hamburger, sans faire passer un contexte React à travers tous les écrans.
 *
 * Le drawer lui-même (état d'ouverture + animation) vit une seule fois, dans le layout `(app)`,
 * qui s'abonne ici et ouvre le panneau. La fermeture, elle, reste locale au drawer (scrim, geste,
 * bouton retour) : ce store ne sert qu'à demander l'ouverture.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Demande l'ouverture du menu latéral. No-op si aucun host n'est monté. */
export function openDrawer(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Abonne un host (le layout `(app)`) aux demandes d'ouverture. Renvoie le désabonnement. */
export function subscribeOpenDrawer(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
