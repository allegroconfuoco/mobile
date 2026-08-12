import { Platform } from 'react-native';
import TrackPlayer, { PlayerCommand } from '@rntp/player';

import { wireForegroundPlayerEvents } from './playerEvents';

/**
 * Initialisation du lecteur (@rntp/player v5).
 *
 * `setupPlayer` est synchrone et ne doit être appelé qu'une fois : on mémorise l'état dans un
 * flag de module. Un rechargement à chaud peut ré-exécuter ce module alors que le natif est déjà
 * prêt : la lib lève alors une erreur « already set up » qu'on avale (le lecteur est utilisable).
 */

// Pas de lecteur natif sur le web : l'init est court-circuitée (cf. bibliothèque « unsupported »).
const isSupported = Platform.OS !== 'web';

let ready = false;

/** Configure le lecteur si besoin ; `true` quand il est prêt, `false` si non supporté. */
export function ensurePlayerReady(): boolean {
  if (!isSupported) {
    return false;
  }
  if (ready) {
    return true;
  }

  try {
    TrackPlayer.setupPlayer({
      // Le tick `PlaybackProgressUpdated` (1 s) n'existe que si progressSync est configuré ;
      // sans URL http, aucun POST ne part — on ne veut que l'événement, pour l'historique
      // d'écoute (#25) et le suivi de position du point de reprise.
      progressSync: { intervalSeconds: 1 },
    });
  } catch (e) {
    // Double init (rechargement à chaud) : le natif est déjà prêt, on continue.
    console.warn('[player] setupPlayer', e);
  }

  // Boutons de la notification / écran verrouillé / Bluetooth. `handling: 'native'` (défaut) :
  // le natif exécute lui-même play/pause/next/prev/seek/stop, aucun relais JS nécessaire
  // (le « précédent intelligent » — >3 s = redémarrer la piste — est natif aussi).
  reassertCommands();

  // Événements côté premier plan (l'arrière-plan passe par le handler headless, cf. index.js).
  wireForegroundPlayerEvents();

  ready = true;
  return true;
}

/**
 * (Ré)applique les commandes distantes (capacités de la notif / écran verrouillé).
 *
 * ⚠️ Appelée à l'init **et à chaque lancement de file** (`playQueue`) : côté natif, `setCommands`
 * persiste la config puis la rediffuse via une commande custom sur le MediaController du module —
 * or ce contrôleur se connecte de façon asynchrone après `setupPlayer`, et la rediffusion est
 * **silencieusement perdue** s'il n'est pas encore connecté (`MainThreadMediaController.run` ne
 * met pas en file). Un contrôleur système déjà connecté (notif d'un service encore vivant) peut
 * alors rester sur des commandes périmées → notif sans bouton suivant. Re-poser les commandes au
 * moment où on charge une file (contrôleur forcément connecté) referme cette fenêtre ; l'appel
 * est idempotent et trivial (écriture SharedPreferences + une commande custom).
 */
export function reassertCommands(): void {
  if (!isSupported) {
    return;
  }
  TrackPlayer.setCommands({
    capabilities: [
      PlayerCommand.PlayPause,
      PlayerCommand.Next,
      PlayerCommand.Previous,
      PlayerCommand.Seek,
      PlayerCommand.Stop,
    ],
  });
}
