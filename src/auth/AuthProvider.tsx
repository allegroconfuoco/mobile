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
 * Le refresh est **sérialisé** (une seule requête en vol) pour ne pas multiplier les allers-retours.
 *
 * **La session ne dépend pas du réseau.** `isAuthenticated` veut dire « il existe un refresh token
 * en stockage sécurisé », pas « le dernier appel au backend a réussi » : seule une réponse 4xx du
 * serveur (jeton révoqué / expiré) ou une déconnexion explicite efface la session. Une panne réseau
 * ou une erreur 5xx laisse la session intacte et bascule simplement `sessionOnline` à faux — sinon
 * un Wi-Fi capricieux au mauvais moment jetait un refresh token pourtant valide 90 jours, et
 * renvoyait sur l'écran de connexion une app dont toute la bibliothèque est locale.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import * as authApi from '@/api/auth';
import { ApiError } from '@/api/auth';
import { isTokenExpired } from './jwt';
import { clearSession, loadSession, saveSession, type StoredSession } from './tokenStorage';

export type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated';

export type AuthContextValue = {
  /** `restoring` tant que la session n'a pas été relue au démarrage (garde le splash). */
  status: AuthStatus;
  isAuthenticated: boolean;
  /**
   * Faux quand le dernier renouvellement de jeton a échoué pour une raison réseau : la session
   * reste valide, mais tout ce qui passe par le backend (synchro, enrichissement) est en attente.
   * Sert au bandeau « hors-ligne » — jamais à garder ou non l'utilisateur dans l'app.
   */
  sessionOnline: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Token d'accès valide (refresh si besoin), ou `null` si le backend est injoignable/la session tombée. */
  getAccessToken: () => Promise<string | null>;
};

/**
 * Vrai si l'erreur est un **refus explicite du serveur** sur le refresh token (révoqué, expiré,
 * inconnu) — le seul cas qui doit déconnecter. Tout le reste (status 0 = réseau, 5xx = serveur
 * en vrac, 429 = throttling) est temporaire : on garde la session et on retentera.
 */
function isSessionRejected(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429
  );
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [sessionOnline, setSessionOnline] = useState(true);

  // Session courante hors cycle de rendu : lue/écrite par getAccessToken sans provoquer de rendu
  // à chaque refresh. `status` reste la projection réactive pour l'UI.
  const sessionRef = useRef<StoredSession | null>(null);
  // Refresh en vol, pour dédupliquer les appels concurrents.
  const refreshPromiseRef = useRef<Promise<StoredSession | null> | null>(null);

  const applySession = useCallback(async (session: StoredSession) => {
    sessionRef.current = session;
    await saveSession(session);
    setSessionOnline(true);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(async () => {
    sessionRef.current = null;
    await clearSession();
    setSessionOnline(true);
    setStatus('unauthenticated');
  }, []);

  /**
   * Rejoue le refresh token (sérialisé). Ne déconnecte que si le serveur **refuse** le jeton :
   * hors-ligne ou backend en vrac, la session est conservée telle quelle et on retentera au
   * prochain besoin (retour au premier plan, synchro…).
   */
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
          setSessionOnline(true);
          return next;
        } catch (error) {
          if (isSessionRejected(error)) {
            await clear();
          } else {
            setSessionOnline(false);
          }
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

  // Restauration au démarrage : la seule chose qui décide, c'est la présence de la session en
  // stockage sécurisé — aucun appel réseau ne peut retenir l'app sur l'écran de connexion. Le
  // renouvellement d'un access token périmé part en fond (il ne bloque ni le splash ni l'accès à
  // la bibliothèque, qui est entièrement locale).
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
      setStatus('authenticated');
      if (isTokenExpired(stored.accessToken)) {
        void doRefresh(stored.refreshToken);
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
        sessionOnline,
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
