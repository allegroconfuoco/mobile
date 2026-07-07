/**
 * Retour haptique centralisé (expo-haptics).
 *
 * Enveloppe fine pour deux raisons : garder les appels courts côté UI, et **no-op sur le web**
 * (cible d'export CI, cf. PROJET.md) comme le reste du code natif. Les erreurs sont avalées :
 * un appareil sans vibreur ne doit jamais faire planter une interaction.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const isSupported = Platform.OS !== 'web';

/** Petit tap : play/pause, ouverture d'une feuille, toggle discret. */
export function tapLight(): void {
  if (!isSupported) {
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Tap plus marqué : like, changement de mode (shuffle/repeat), saut de piste. */
export function tapMedium(): void {
  if (!isSupported) {
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Bref accusé de sélection : prise en main d'un glisser (drag), passage d'un cran. */
export function selection(): void {
  if (!isSupported) {
    return;
  }
  void Haptics.selectionAsync().catch(() => {});
}
