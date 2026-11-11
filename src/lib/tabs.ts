import { useSyncExternalStore } from 'react';

/**
 * Onglet actif de l'app — store de module.
 *
 * La barre d'onglets vit dans le « chrome » bas du layout (elle reste visible sur les écrans de
 * détail), alors que le contenu des onglets vit dans l'écran d'accueil du Stack. Les deux doivent
 * partager l'onglet courant sans être parent l'un de l'autre : d'où un store hors React, lu avec
 * `useSyncExternalStore`.
 *
 * Volontairement **pas** un navigateur à onglets : les quatre vues sont de simples panneaux d'un
 * même écran, gardés montés. Changer d'onglet ne monte ni ne démonte rien — c'est instantané et
 * chaque liste garde sa position de défilement.
 */
export type TabKey = 'tracks' | 'playlists' | 'artists' | 'stats';

export const TAB_ORDER: readonly TabKey[] = ['tracks', 'playlists', 'artists', 'stats'];

let current: TabKey = 'tracks';
const listeners = new Set<() => void>();
const reselectListeners = new Set<(tab: TabKey) => void>();

export function getTab(): TabKey {
  return current;
}

/** Change d'onglet. Sans effet si c'est déjà l'onglet courant. */
export function setTab(next: TabKey): void {
  if (next === current) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Onglet courant, réactif. */
export function useTab(): TabKey {
  return useSyncExternalStore(subscribe, getTab, getTab);
}

/**
 * Signale un nouveau tap sur l'onglet **déjà actif** : la vue concernée remonte en haut de sa
 * liste (convention des barres d'onglets, et raccourci utile sur une longue bibliothèque).
 */
export function notifyTabReselected(tab: TabKey): void {
  for (const listener of reselectListeners) {
    listener(tab);
  }
}

export function subscribeTabReselected(listener: (tab: TabKey) => void): () => void {
  reselectListeners.add(listener);
  return () => {
    reselectListeners.delete(listener);
  };
}
