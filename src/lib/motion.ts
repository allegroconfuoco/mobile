import { useEffect } from 'react';
import {
  Easing,
  useSharedValue,
  withSpring,
  type SharedValue,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';

/**
 * Réglages de mouvement partagés par toute l'app.
 *
 * Tout ce qui bouge passe par Reanimated : les animations et les gestes sont calculés sur le
 * thread d'interface, donc ils restent fluides même quand le JS est occupé (scan, re-rendu d'une
 * longue liste). Centraliser les réglages ici garde une même « matière » d'un écran à l'autre —
 * un ressort n'a pas à rebondir différemment selon le composant qui l'utilise.
 */

/** Ressort vif et presque sans rebond : ce qui se pose après un geste (carrousel, feuille, ligne). */
export const SPRING_SNAPPY: WithSpringConfig = { mass: 1, stiffness: 320, damping: 32 };

/** Ressort un peu plus souple, léger dépassement : retours tactiles (appui, cœur, coche). */
export const SPRING_BOUNCY: WithSpringConfig = { mass: 1, stiffness: 380, damping: 20 };

/** Courbe de sortie douce (décélération) : ce qui entre à l'écran. */
export const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Courbe d'entrée (accélération) : ce qui quitte l'écran. */
export const EASE_IN = Easing.bezier(0.4, 0, 1, 1);

/** Durées de référence (ms). */
export const DURATION = {
  /** Retour immédiat : fondu d'un état, sortie d'un élément. */
  fast: 120,
  /** Transition courante : entrée d'un panneau, changement d'onglet. */
  base: 200,
  /** Mouvement ample : feuille, changement de page. */
  slow: 280,
} as const;

/** Entrée standard : `withTiming(valeur, TIMING_IN)`. */
export const TIMING_IN: WithTimingConfig = { duration: DURATION.base, easing: EASE_OUT };

/** Sortie standard, plus courte que l'entrée : ce qui part ne doit pas retenir l'attention. */
export const TIMING_OUT: WithTimingConfig = { duration: DURATION.fast, easing: EASE_IN };

/**
 * Valeur partagée qui suit un booléen de l'interface : elle glisse vers 1 quand `on` devient vrai
 * et vers 0 sinon, sur un ressort. Les styles animés en dérivent (opacité, échelle, rotation…).
 *
 * Pourquoi ce détour plutôt qu'un `withSpring(on ? 1 : 0)` écrit directement dans le style
 * animé : un style animé ne se recalcule de façon fiable que lorsqu'une **valeur partagée** qu'il
 * lit change. Une prop React capturée par sa fonction (l'état de lecture, l'onglet actif) n'est pas
 * toujours prise en compte — on l'a constaté avec l'icône lecture / pause qui restait figée quand
 * la lecture démarrait depuis une liste. L'effet ci-dessous fait le pont, une fois par changement.
 */
export function useSpringFlag(
  on: boolean,
  config: WithSpringConfig = SPRING_SNAPPY
): SharedValue<number> {
  const value = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    value.set(withSpring(on ? 1 : 0, config));
  }, [on, value, config]);
  return value;
}
