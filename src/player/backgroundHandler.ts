import { Platform } from 'react-native';
import TrackPlayer from '@rntp/player';

import { dispatchPlayerEvent } from './playerEvents';

/**
 * Enregistre le handler d'événements **arrière-plan** de @rntp/player (module à effet de bord,
 * importé par `index.js` AVANT `expo-router/entry` — les imports s'exécutent dans l'ordre, le
 * handler est donc posé avant l'enregistrement du composant racine, comme la doc l'exige).
 *
 * C'est le canal par lequel le natif livre les événements (tick de progression, changement de
 * piste, erreurs) quand l'app est en arrière-plan — au premier plan, ils passent par
 * `addEventListener` (cf. `playerEvents.ts`) ; le natif choisit UN canal selon l'état de l'app.
 */

// Pas de handler sur le web (aucun lecteur en arrière-plan à piloter).
if (Platform.OS !== 'web') {
  TrackPlayer.registerBackgroundEventHandler(() => async (event) => {
    dispatchPlayerEvent(event);
  });
}
