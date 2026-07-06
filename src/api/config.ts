/**
 * Configuration de l'accès au backend Fuoco (Symfony + API Platform).
 *
 * L'URL de base dépend de *où tourne le backend* et de *quel appareil* lance l'app :
 * émulateur Android, appareil physique sur le LAN, DDEV… donc elle n'est pas codée en dur.
 * On la lit dans `EXPO_PUBLIC_API_URL` (variable inlinée par Expo au build, cf.
 * https://docs.expo.dev/guides/environment-variables/). Créer un `.env` à la racine du repo
 * mobile, par exemple :
 *
 *   EXPO_PUBLIC_API_URL=http://192.168.1.42:8000
 *
 * ⚠️ Un appareil physique ne résout NI `localhost` NI `*.ddev.site` : il faut l'IP LAN de la
 * machine qui héberge le backend, et Symfony démarré en écoute publique
 * (`symfony serve --listen-ip=0.0.0.0`, ou le routeur DDEV exposé sur le LAN).
 *
 * Fallback : `10.0.2.2`, l'alias que l'émulateur Android donne au `localhost` de l'hôte.
 */
const DEFAULT_BASE_URL = 'http://10.0.2.2:8000';

/** Racine de l'API sans slash final (ex. `http://10.0.2.2:8000`). */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_BASE_URL).replace(
  /\/$/,
  ''
);

/** Construit une URL absolue vers un chemin d'API (`path` commençant par `/`). */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
