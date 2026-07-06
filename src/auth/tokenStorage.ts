/**
 * Persistance sécurisée de la session (access token + refresh token).
 *
 * Sur appareil : `expo-secure-store` (Keystore Android — chiffré au repos, pas en clair dans
 * les SharedPreferences). Le web étant hors périmètre (Android only) mais devant tout de même
 * builder, on retombe sur un simple objet mémoire — même parti pris que les shims RNTP/SQLite.
 *
 * On stocke deux clés distinctes plutôt qu'un blob JSON : chaque valeur reste courte (bien sous
 * la limite ~2 Ko de SecureStore) et lisible indépendamment.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS_TOKEN_KEY = 'fuoco.auth.accessToken';
const REFRESH_TOKEN_KEY = 'fuoco.auth.refreshToken';

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
};

const isWeb = Platform.OS === 'web';

/** Repli mémoire pour le web (non persistant, hors périmètre — juste pour que le bundle tourne). */
const memoryStore = new Map<string, string>();

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    memoryStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    return memoryStore.get(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    memoryStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** Lit la session stockée, ou `null` si l'un des deux jetons manque. */
export async function loadSession(): Promise<StoredSession | null> {
  const [accessToken, refreshToken] = await Promise.all([
    getItem(ACCESS_TOKEN_KEY),
    getItem(REFRESH_TOKEN_KEY),
  ]);
  if (!accessToken || !refreshToken) {
    return null;
  }
  return { accessToken, refreshToken };
}

/** Écrit la paire de jetons. */
export async function saveSession(session: StoredSession): Promise<void> {
  await Promise.all([
    setItem(ACCESS_TOKEN_KEY, session.accessToken),
    setItem(REFRESH_TOKEN_KEY, session.refreshToken),
  ]);
}

/** Efface toute la session (déconnexion). */
export async function clearSession(): Promise<void> {
  await Promise.all([deleteItem(ACCESS_TOKEN_KEY), deleteItem(REFRESH_TOKEN_KEY)]);
}
