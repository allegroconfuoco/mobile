/**
 * Redirection des URLs système avant routage (fichier spécial expo-router `+native-intent`).
 *
 * La notification média Android (react-native-track-player) ouvre l'app avec l'URI
 * `trackplayer://notification.click` (posée par `MusicService.kt` ; `trackplayer://service-bound`
 * existe aussi sur certains chemins de relance du service). Sans cette redirection, expo-router
 * tente de router « notification.click » et affiche « Unmatched route ». Le tap de notification
 * mène à l'écran Lecture ; toute autre URI `trackplayer://` retombe sur la racine.
 *
 * ⚠️ Ne jamais lever d'exception ici : ça planterait l'app au démarrage (cf. doc expo-router).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes('notification.click')) {
      return '/now-playing';
    }
    if (path.startsWith('trackplayer://')) {
      return '/';
    }
    return path;
  } catch {
    return '/';
  }
}
