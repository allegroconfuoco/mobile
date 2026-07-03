import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import TrackPlayer, { State, type Track } from 'react-native-track-player';

import { type LocalTrack } from '@/library/useAudioLibrary';
import { ensurePlayerReady } from './setup';
import { toPlayerTrack } from './track';

/** Commandes de lecture exposées à l'UI. L'état réactif, lui, passe par `usePlayback`. */
export type PlayerActions = {
  /**
   * Charge `tracks` comme file de lecture et démarre à l'index `startIndex`.
   * Les titres dont l'URI est introuvable sont ignorés ; l'index de départ est réaligné
   * sur le titre réellement tapé pour rester juste malgré ces trous.
   */
  playQueue: (tracks: LocalTrack[], startIndex: number) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  skipToNext: () => void;
  skipToPrevious: () => void;
  /** Position absolue en secondes. */
  seekTo: (seconds: number) => void;
};

const PlayerContext = createContext<PlayerActions | null>(null);

/**
 * Monte le lecteur et fournit ses commandes à l'arbre.
 *
 * L'initialisation est déclenchée au montage mais reste paresseuse et idempotente
 * (cf. `ensurePlayerReady`) : chaque action s'assure que le lecteur est prêt avant d'agir,
 * donc un tap très précoce n'est jamais perdu.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void ensurePlayerReady();
  }, []);

  const playQueue = useCallback(async (tracks: LocalTrack[], startIndex: number) => {
    if (!(await ensurePlayerReady()) || tracks.length === 0) {
      return;
    }
    const targetId = tracks[startIndex]?.id;

    const resolved = (
      await Promise.all(
        tracks.map(async (track) => {
          try {
            return await toPlayerTrack(track);
          } catch (e) {
            console.warn('[player] URI introuvable, piste ignorée', track.filename, e);
            return null;
          }
        })
      )
    ).filter((track): track is Track => track !== null);

    if (resolved.length === 0) {
      return;
    }
    const resumeIndex = Math.max(
      0,
      resolved.findIndex((track) => track.id === targetId)
    );

    await TrackPlayer.setQueue(resolved);
    await TrackPlayer.skip(resumeIndex);
    await TrackPlayer.play();
  }, []);

  const togglePlayPause = useCallback(async () => {
    if (!(await ensurePlayerReady())) {
      return;
    }
    const { state } = await TrackPlayer.getPlaybackState();
    if (state === State.Playing || state === State.Buffering || state === State.Loading) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  }, []);

  const skipToNext = useCallback(() => void TrackPlayer.skipToNext().catch(() => {}), []);
  const skipToPrevious = useCallback(() => void TrackPlayer.skipToPrevious().catch(() => {}), []);
  const seekTo = useCallback((seconds: number) => void TrackPlayer.seekTo(seconds), []);

  const actions = useMemo<PlayerActions>(
    () => ({ playQueue, togglePlayPause, skipToNext, skipToPrevious, seekTo }),
    [playQueue, togglePlayPause, skipToNext, skipToPrevious, seekTo]
  );

  return <PlayerContext.Provider value={actions}>{children}</PlayerContext.Provider>;
}

/** Accès aux commandes de lecture. À utiliser sous `PlayerProvider`. */
export function usePlayer(): PlayerActions {
  const actions = useContext(PlayerContext);
  if (!actions) {
    throw new Error('usePlayer doit être utilisé dans un <PlayerProvider>.');
  }
  return actions;
}
