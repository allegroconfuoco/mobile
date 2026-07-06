/**
 * Contexte des playlists : une seule instance de `usePlaylists` pour toute l'app.
 *
 * Même motif que `LibraryProvider`/`PlayerProvider` : l'onglet Bibliothèque (vue Playlists), le
 * menu d'ajout et l'écran de détail doivent partager le *même* état — créer une playlist ici doit
 * la faire apparaître là. Monté au-dessus des écrans dans `_layout.tsx`.
 */
import { createContext, useContext, type ReactNode } from 'react';

import { usePlaylists, type UsePlaylists } from './usePlaylists';

const PlaylistsContext = createContext<UsePlaylists | null>(null);

export function PlaylistsProvider({ children }: { children: ReactNode }) {
  const playlists = usePlaylists();
  return <PlaylistsContext.Provider value={playlists}>{children}</PlaylistsContext.Provider>;
}

/** Accès à l'état partagé des playlists. À utiliser sous `PlaylistsProvider`. */
export function usePlaylistsContext(): UsePlaylists {
  const ctx = useContext(PlaylistsContext);
  if (!ctx) {
    throw new Error('usePlaylistsContext doit être utilisé sous <PlaylistsProvider>.');
  }
  return ctx;
}
