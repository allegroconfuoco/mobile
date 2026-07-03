import { Platform } from 'react-native';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  RepeatMode,
} from 'react-native-track-player';

/**
 * Initialisation du lecteur.
 *
 * `setupPlayer` / `updateOptions` ne doivent être appelés qu'une seule fois. On mémorise donc
 * la promesse : les appels concurrents (montage du provider, premier tap sur une piste) la
 * partagent, et on ne relance pas l'init une fois qu'elle a réussi. En cas d'échec, on relâche
 * la promesse pour autoriser une nouvelle tentative.
 */

// Pas de lecteur natif sur le web : l'init est court-circuitée (cf. bibliothèque « unsupported »).
const isSupported = Platform.OS !== 'web';

let setupPromise: Promise<boolean> | null = null;

/** Configure le lecteur si besoin ; résout `true` quand il est prêt, `false` si non supporté. */
export function ensurePlayerReady(): Promise<boolean> {
  if (!setupPromise) {
    setupPromise = runSetup();
  }
  return setupPromise;
}

async function runSetup(): Promise<boolean> {
  if (!isSupported) {
    return false;
  }

  try {
    await setupWithBackgroundRetry();
  } catch (e) {
    // Un second `setupPlayer` (ex. rechargement à chaud) lève « already initialized » :
    // le lecteur est en réalité prêt, on continue. Toute autre erreur est un vrai échec.
    if ((e as { code?: string }).code !== 'player_already_initialized') {
      console.warn('[player] setup échoué', e);
      setupPromise = null;
      return false;
    }
  }

  await TrackPlayer.updateOptions({
    android: {
      // La musique continue quand l'app est tuée : c'est un lecteur, pas une appli au premier plan.
      appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
    },
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
      Capability.SeekTo,
      Capability.Stop,
    ],
    notificationCapabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    progressUpdateEventInterval: 1,
  });
  await TrackPlayer.setRepeatMode(RepeatMode.Queue);

  return true;
}

/**
 * Sur Android, `setupPlayer` échoue si l'app est en arrière-plan au démarrage
 * (`android_cannot_setup_player_in_background`). On réessaie jusqu'à revenir au premier plan.
 */
async function setupWithBackgroundRetry(): Promise<void> {
  for (;;) {
    try {
      await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== 'android_cannot_setup_player_in_background') {
        throw e;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }
}
