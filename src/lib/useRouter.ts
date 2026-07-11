import { useMemo } from 'react';
import { useRouter as useExpoRouter, type Href, type ImperativeRouter } from 'expo-router';

/**
 * `useRouter` d'expo-router avec un garde anti double-tap sur `push`.
 *
 * Sans garde, deux taps rapprochés sur une même ligne déclenchent deux `push` avant que la
 * transition ne rende l'écran source inerte → le même écran s'empile deux fois. Le garde est
 * **global** (état de module, pas par composant) : les deux taps peuvent venir de deux zones
 * différentes visant la même destination (ligne + icône, par exemple).
 *
 * On ne bloque que la répétition de la **même destination** dans une courte fenêtre : naviguer
 * vite vers deux écrans différents reste possible. `back`/`replace`/etc. passent inchangés.
 */

/** Fenêtre pendant laquelle re-pousser la même destination est ignoré. */
const PUSH_COOLDOWN_MS = 800;

let lastHrefKey = '';
let lastPushAt = 0;

/** Sérialise une destination pour comparer deux push (pathname + params). */
function hrefKey(href: Href): string {
  return typeof href === 'string' ? href : JSON.stringify(href);
}

export function useRouter(): ImperativeRouter {
  const router = useExpoRouter();

  return useMemo(
    () => ({
      ...router,
      push: (href: Href, options?: Parameters<ImperativeRouter['push']>[1]) => {
        const key = hrefKey(href);
        const now = Date.now();
        if (key === lastHrefKey && now - lastPushAt < PUSH_COOLDOWN_MS) {
          return;
        }
        lastHrefKey = key;
        lastPushAt = now;
        router.push(href, options);
      },
    }),
    [router]
  );
}
