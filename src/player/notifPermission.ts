import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Permission `POST_NOTIFICATIONS` (Android 13+ / API 33).
 *
 * Sans elle, la notification média du foreground service RNTP est silencieusement masquée :
 * la lecture continue mais sans contrôles notification/écran verrouillé. On la demande
 * paresseusement au premier lancement de lecture (moment où l'utilisateur comprend pourquoi),
 * une seule fois par session, et sans jamais bloquer la lecture : un refus dégrade seulement
 * l'affichage de la notification.
 */

let requested = false;

export function requestNotificationPermission(): void {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33 || requested) {
    return;
  }
  requested = true;
  // Fire-and-forget : la lecture ne doit pas attendre la réponse au dialogue système.
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {
    // Un échec de la demande n'est jamais bloquant ; on retentera à la prochaine session.
    requested = false;
  });
}
