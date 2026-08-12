/**
 * Contexte de synchro playlists (issue #17) : orchestre *quand* déclencher `runSync` et expose un
 * état léger à l'UI.
 *
 * Monté sous `PlaylistsProvider` (il lit `useAuth` ET `usePlaylistsContext`). Après un pull réussi,
 * appelle `refresh()` pour que les écrans relisent SQLite (source de vérité unique).
 *
 * Déclencheurs (tous gardés : natif uniquement, authentifié, sérialisés) :
 *  - connexion (transition `isAuthenticated`) ;
 *  - retour de l'app au premier plan (`AppState` → `active`) ;
 *  - après une mutation locale, débouncé (~2,5 s) — en ignorant le rebond de `revision` provoqué
 *    par le `refresh()` d'après-pull, pour ne pas boucler ;
 *  - bouton manuel (Réglages) via `syncNow()`.
 *
 * Sur web (hors périmètre) : no-op complet, aucun appel réseau.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import { runPlaySync } from './playSync';
import { runSync, type SyncResult } from './syncEngine';

/** État de synchro exposé à l'UI. */
export type SyncStatus = 'idle' | 'syncing' | 'error';

export type SyncContextValue = {
  status: SyncStatus;
  /** Horodatage (ms) du dernier sync réussi, ou `null`. */
  lastSyncedAt: number | null;
  /**
   * Issue de la dernière **tentative** de synchro (réussie ou non), ou `null` si aucune.
   * Sert d'indicateur hors-ligne (lot 6 de l'audit) sans dépendance netinfo : `offline` = la
   * dernière tentative a échoué faute de réseau (`ApiError.status === 0` dans l'engine).
   */
  lastSync: { at: number; result: SyncResult } | null;
  /** Déclenche une synchro (idempotent si une est déjà en vol). */
  syncNow: () => Promise<SyncResult>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

const ENABLED = Platform.OS !== 'web';
const EDIT_DEBOUNCE_MS = 2500;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, isAuthenticated } = useAuth();
  const { revision, refresh } = usePlaylistsContext();

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<{ at: number; result: SyncResult } | null>(null);

  // Synchro en vol, pour sérialiser (mêmes déclencheurs peuvent se chevaucher).
  const inFlightRef = useRef<Promise<SyncResult> | null>(null);
  // `revision` courante hors rendu, pour prédire le rebond que `refresh()` va provoquer.
  const revisionRef = useRef(revision);
  // `revision` issue du `refresh()` d'après-pull : à ignorer par le déclencheur débouncé.
  const skipRevisionRef = useRef(0);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  const syncNow = useCallback(async (): Promise<SyncResult> => {
    if (!ENABLED || !isAuthenticated) {
      return 'skipped';
    }
    if (inFlightRef.current) {
      return inFlightRef.current;
    }
    const run = (async (): Promise<SyncResult> => {
      setStatus('syncing');
      try {
        // Playlists d'abord (elle porte la gestion multi-comptes / wipe), puis l'historique
        // d'écoute (#25). Le résultat exposé est le plus dégradé des deux, pour que
        // l'indicateur hors-ligne/erreur reflète l'ensemble.
        const playlistsResult = await runSync(getAccessToken);
        const playsResult = await runPlaySync(getAccessToken);
        const result: SyncResult =
          playlistsResult === 'error' || playsResult === 'error'
            ? 'error'
            : playlistsResult === 'offline' || playsResult === 'offline'
              ? 'offline'
              : playlistsResult;
        if (result === 'ok') {
          // Le pull a pu changer la base : on rafraîchit l'UI. Ce `refresh()` incrémente
          // `revision` ; on note la valeur attendue pour que le déclencheur débouncé l'ignore.
          skipRevisionRef.current = revisionRef.current + 1;
          refresh();
          setLastSyncedAt(Date.now());
        }
        setStatus(result === 'error' ? 'error' : 'idle');
        // `skipped` (non connecté) n'est pas une tentative : on ne l'enregistre pas.
        if (result !== 'skipped') {
          setLastSync({ at: Date.now(), result });
        }
        return result;
      } catch {
        setStatus('error');
        setLastSync({ at: Date.now(), result: 'error' });
        return 'error';
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [getAccessToken, isAuthenticated, refresh]);

  // Connexion (ou app déjà connectée au montage) : première synchro.
  useEffect(() => {
    if (ENABLED && isAuthenticated) {
      void syncNow();
    }
  }, [isAuthenticated, syncNow]);

  // Retour au premier plan.
  useEffect(() => {
    if (!ENABLED) {
      return;
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isAuthenticated) {
        void syncNow();
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, syncNow]);

  // Après une mutation locale (débouncé). On ignore le rebond de `revision` dû au `refresh()`
  // d'après-pull (sinon boucle : sync → refresh → revision++ → sync…).
  useEffect(() => {
    if (!ENABLED || !isAuthenticated || revision === skipRevisionRef.current) {
      return;
    }
    const timer = setTimeout(() => void syncNow(), EDIT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [revision, isAuthenticated, syncNow]);

  return (
    <SyncContext.Provider value={{ status, lastSyncedAt, lastSync, syncNow }}>
      {children}
    </SyncContext.Provider>
  );
}

/** Accès à l'état de synchro. À utiliser sous `<SyncProvider>`. */
export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error('useSync doit être utilisé sous <SyncProvider>.');
  }
  return ctx;
}
