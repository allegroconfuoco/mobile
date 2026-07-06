/**
 * Contexte d'authentification : source de vérité unique de la session pour toute l'app.
 *
 * Monté au-dessus des écrans dans `_layout.tsx` (même motif que Library/Playlists/Player).
 * Il orchestre les appels de `src/api/auth.ts` et la persistance de `src/auth/tokenStorage.ts` :
 *   - restaure la session au démarrage (et refresh si l'access token est déjà périmé) ;
 *   - `signIn` / `signUp` / `signOut` ;
 *   - `getAccessToken()` : renvoie un token valide (refresh transparent), pour les futurs appels
 *     protégés (synchro playlists, Phase 1) — aucun endpoint protégé n'est encore consommé.
 *
 * Le refresh est **sérialisé** (une seule requête en vol) : le refresh token est `single_use`
 * côté backend (gesdinet), donc deux refresh concurrents en invalideraient un et casseraient la
 * session. En cas d'échec de refresh (token révoqué/expiré 90 j), on déconnecte proprement.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import * as authApi from '@/api/auth';
import { isTokenExpired } from './jwt';
import { clearSession, loadSession, saveSession, type StoredSession } from './tokenStorage';

export type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated';

export type AuthContextValue = {
  /** `restoring` tant que la session n'a pas été relue au démarrage (garde le splash). */
  status: AuthStatus;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Token d'accès valide (refresh si besoin), ou `null` si la session est tombée. */
  getAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');

  // Session courante hors cycle de rendu : lue/écrite par getAccessToken sans provoquer de rendu
  // à chaque refresh. `status` reste la projection réactive pour l'UI.
  const sessionRef = useRef<StoredSession | null>(null);
  // Refresh en vol, pour sérialiser (single_use) et dédupliquer les appels concurrents.
  const refreshPromiseRef = useRef<Promise<StoredSession | null> | null>(null);

  const applySession = useCallback(async (session: StoredSession) => {
    sessionRef.current = session;
    await saveSession(session);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(async () => {
    sessionRef.current = null;
    await clearSession();
    setStatus('unauthenticated');
  }, []);

  /** Rejoue le refresh token (sérialisé). Met à jour la session ou déconnecte si échec. */
  const doRefresh = useCallback(
    (refreshToken: string): Promise<StoredSession | null> => {
      if (refreshPromiseRef.current) {
        return refreshPromiseRef.current;
      }
      const promise = (async () => {
        try {
          const pair = await authApi.refresh(refreshToken);
          const next: StoredSession = { accessToken: pair.token, refreshToken: pair.refreshToken };
          sessionRef.current = next;
          await saveSession(next);
          return next;
        } catch {
          await clear();
          return null;
        } finally {
          refreshPromiseRef.current = null;
        }
      })();
      refreshPromiseRef.current = promise;
      return promise;
    },
    [clear]
  );

  // Restauration au démarrage : lit le stockage sécurisé, refresh si l'access token est périmé.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      if (cancelled) {
        return;
      }
      if (!stored) {
        setStatus('unauthenticated');
        return;
      }
      sessionRef.current = stored;
      if (isTokenExpired(stored.accessToken)) {
        const refreshed = await doRefresh(stored.refreshToken);
        if (!cancelled) {
          setStatus(refreshed ? 'authenticated' : 'unauthenticated');
        }
      } else {
        setStatus('authenticated');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doRefresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const pair = await authApi.login(email, password);
      await applySession({ accessToken: pair.token, refreshToken: pair.refreshToken });
    },
    [applySession]
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      // /register ne renvoie pas de jeton : on enchaîne un login avec les mêmes identifiants.
      await authApi.register(email, password, displayName);
      const pair = await authApi.login(email, password);
      await applySession({ accessToken: pair.token, refreshToken: pair.refreshToken });
    },
    [applySession]
  );

  const signOut = useCallback(async () => {
    await clear();
  }, [clear]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const current = sessionRef.current;
    if (!current) {
      return null;
    }
    if (!isTokenExpired(current.accessToken)) {
      return current.accessToken;
    }
    const refreshed = await doRefresh(current.refreshToken);
    return refreshed?.accessToken ?? null;
  }, [doRefresh]);

  return (
    <AuthContext.Provider
      value={{
        status,
        isAuthenticated: status === 'authenticated',
        signIn,
        signUp,
        signOut,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Accès à la session. À utiliser sous `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth doit être utilisé sous <AuthProvider>.');
  }
  return ctx;
}
