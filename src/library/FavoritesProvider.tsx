/**
 * Contexte des favoris (finition Phase 1) : morceaux « likés », local-only.
 *
 * Même motif que `PlaylistsProvider` : une seule instance partagée par toute l'app (le coeur du
 * Now Playing, l'action du menu long-press et la vue Favoris de la bibliothèque doivent refléter
 * le même état). SQLite reste la source de vérité ; on garde ici un `Set` d'ids media-store en
 * mémoire, initialisé synchroniquement depuis la base et muté à chaque toggle.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import * as db from './db';

export type UseFavorites = {
  /** Ids media-store des pistes favorites (ordre non garanti ; pour l'appartenance). */
  favoriteIds: Set<string>;
  /** La piste est-elle likée ? */
  isFavorite: (trackId: string) => boolean;
  /**
   * Bascule l'état favori d'une piste et renvoie le **nouvel** état (`true` = likée).
   * `mbid` est stocké en réserve pour une future synchro (inerte en Phase 1).
   */
  toggleFavorite: (trackId: string, mbid?: string | null) => boolean;
  /**
   * Ajoute un lot de pistes aux favoris (action groupée du mode sélection). Sens « liker »
   * uniquement : les pistes déjà likées sont laissées telles quelles (pas un toggle). Renvoie le
   * nombre de pistes réellement ajoutées.
   */
  addFavorites: (entries: { id: string; mbid?: string | null }[]) => number;
};

const FavoritesContext = createContext<UseFavorites | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set(db.loadFavoriteIds()));

  const isFavorite = useCallback((trackId: string) => favoriteIds.has(trackId), [favoriteIds]);

  const toggleFavorite = useCallback((trackId: string, mbid: string | null = null) => {
    const nowLiked = db.toggleFavorite(trackId, mbid, Date.now());
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (nowLiked) {
        next.add(trackId);
      } else {
        next.delete(trackId);
      }
      return next;
    });
    return nowLiked;
  }, []);

  const addFavorites = useCallback((entries: { id: string; mbid?: string | null }[]) => {
    const added = db.addFavorites(
      entries.map((e) => ({ trackId: e.id, mbid: e.mbid ?? null })),
      Date.now()
    );
    if (added.length > 0) {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        for (const id of added) {
          next.add(id);
        }
        return next;
      });
    }
    return added.length;
  }, []);

  const value = useMemo<UseFavorites>(
    () => ({ favoriteIds, isFavorite, toggleFavorite, addFavorites }),
    [favoriteIds, isFavorite, toggleFavorite, addFavorites]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

/** Accès à l'état partagé des favoris. À utiliser sous `FavoritesProvider`. */
export function useFavorites(): UseFavorites {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error('useFavorites doit être utilisé sous <FavoritesProvider>.');
  }
  return ctx;
}
