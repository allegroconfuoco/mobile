/**
 * Contexte de bibliothèque : une seule instance de `useAudioLibrary` pour toute l'app.
 *
 * `useAudioLibrary` porte un état SQLite en mémoire (pistes, préférences de dossiers, exclusions).
 * L'écran Bibliothèque et l'écran Réglages > Bibliothèque locale doivent partager *le même* état :
 * un dossier décoché dans les réglages doit disparaître immédiatement de la liste. On monte donc
 * le hook une seule fois, ici, au-dessus des écrans — même motif que `PlayerProvider`.
 */
import { createContext, useContext, type ReactNode } from 'react';

import { useAudioLibrary } from './useAudioLibrary';

type LibraryContextValue = ReturnType<typeof useAudioLibrary>;

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const library = useAudioLibrary();
  return <LibraryContext.Provider value={library}>{children}</LibraryContext.Provider>;
}

/** Accès à l'état partagé de la bibliothèque. À utiliser sous `LibraryProvider`. */
export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) {
    throw new Error('useLibrary doit être utilisé sous <LibraryProvider>.');
  }
  return ctx;
}
