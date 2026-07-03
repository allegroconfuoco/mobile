import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import TrackPlayer, { Event, State, type Track } from 'react-native-track-player';

import { type LocalTrack } from '@/library/useAudioLibrary';
import { ensurePlayerReady } from './setup';
import { resolvePlayerTracks } from './track';

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

/** Gestion de la file de lecture : mutations + saut direct à un index. */
export type QueueActions = {
  /** Ajoute `tracks` à la fin de la file (sans changer la lecture en cours). */
  addToQueue: (tracks: LocalTrack[]) => Promise<void>;
  /** Insère `tracks` juste après la piste courante (« Lire ensuite »). */
  playNext: (tracks: LocalTrack[]) => Promise<void>;
  /** Retire la piste à `index` de la file. */
  removeFromQueue: (index: number) => Promise<void>;
  /** Déplace la piste de `fromIndex` vers `toIndex` (réordonnancement). */
  moveInQueue: (fromIndex: number, toIndex: number) => Promise<void>;
  /** Saute à la piste `index` de la file et lance la lecture. */
  skipToIndex: (index: number) => Promise<void>;
};

/** Instantané réactif de la file, pour l'affichage. */
export type QueueState = {
  tracks: Track[];
  /** Index de la piste en cours dans `tracks`, ou `undefined` si la file est vide. */
  activeIndex: number | undefined;
};

const PlayerContext = createContext<(PlayerActions & QueueActions) | null>(null);
const QueueContext = createContext<QueueState | null>(null);

/**
 * Monte le lecteur et fournit ses commandes à l'arbre.
 *
 * L'initialisation est déclenchée au montage mais reste paresseuse et idempotente
 * (cf. `ensurePlayerReady`) : chaque action s'assure que le lecteur est prêt avant d'agir,
 * donc un tap très précoce n'est jamais perdu.
 *
 * Deux contextes distincts pour éviter des rendus inutiles : les *actions* sont stables, tandis
 * que le *snapshot* de la file (`QueueState`) change à chaque mutation ou avancement de piste.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueState>({ tracks: [], activeIndex: undefined });

  // Recharge le snapshot de la file depuis le lecteur (source de vérité).
  const refreshQueue = useCallback(async () => {
    if (!(await ensurePlayerReady())) {
      return;
    }
    const [tracks, activeIndex] = await Promise.all([
      TrackPlayer.getQueue(),
      TrackPlayer.getActiveTrackIndex(),
    ]);
    setQueue({ tracks, activeIndex });
  }, []);

  useEffect(() => {
    void ensurePlayerReady().then((ready) => {
      if (ready) {
        void refreshQueue();
      }
    });

    // La piste active change sur skip, avancement naturel et remplacement de file : autant de
    // moments où le snapshot doit se resynchroniser. Les mutations (add/remove/move) rafraîchissent
    // en plus directement, car elles ne changent pas forcément la piste active.
    const sub = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => {
      void refreshQueue();
    });
    return () => sub.remove();
  }, [refreshQueue]);

  const playQueue = useCallback(
    async (tracks: LocalTrack[], startIndex: number) => {
      if (!(await ensurePlayerReady()) || tracks.length === 0) {
        return;
      }
      const targetId = tracks[startIndex]?.id;
      const resolved = await resolvePlayerTracks(tracks);
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
      await refreshQueue();
    },
    [refreshQueue]
  );

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

  const addToQueue = useCallback(
    async (tracks: LocalTrack[]) => {
      if (!(await ensurePlayerReady())) {
        return;
      }
      const resolved = await resolvePlayerTracks(tracks);
      if (resolved.length === 0) {
        return;
      }
      await TrackPlayer.add(resolved);
      await refreshQueue();
    },
    [refreshQueue]
  );

  const playNext = useCallback(
    async (tracks: LocalTrack[]) => {
      if (!(await ensurePlayerReady())) {
        return;
      }
      const resolved = await resolvePlayerTracks(tracks);
      if (resolved.length === 0) {
        return;
      }
      // Sans piste active (file vide), on ajoute simplement à la fin.
      const activeIndex = await TrackPlayer.getActiveTrackIndex();
      const insertBefore = activeIndex != null ? activeIndex + 1 : undefined;
      await TrackPlayer.add(resolved, insertBefore);
      await refreshQueue();
    },
    [refreshQueue]
  );

  const removeFromQueue = useCallback(
    async (index: number) => {
      if (!(await ensurePlayerReady())) {
        return;
      }
      await TrackPlayer.remove(index);
      await refreshQueue();
    },
    [refreshQueue]
  );

  const moveInQueue = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!(await ensurePlayerReady())) {
        return;
      }
      await TrackPlayer.move(fromIndex, toIndex);
      await refreshQueue();
    },
    [refreshQueue]
  );

  const skipToIndex = useCallback(
    async (index: number) => {
      if (!(await ensurePlayerReady())) {
        return;
      }
      await TrackPlayer.skip(index);
      await TrackPlayer.play();
      await refreshQueue();
    },
    [refreshQueue]
  );

  const actions = useMemo<PlayerActions & QueueActions>(
    () => ({
      playQueue,
      togglePlayPause,
      skipToNext,
      skipToPrevious,
      seekTo,
      addToQueue,
      playNext,
      removeFromQueue,
      moveInQueue,
      skipToIndex,
    }),
    [
      playQueue,
      togglePlayPause,
      skipToNext,
      skipToPrevious,
      seekTo,
      addToQueue,
      playNext,
      removeFromQueue,
      moveInQueue,
      skipToIndex,
    ]
  );

  return (
    <PlayerContext.Provider value={actions}>
      <QueueContext.Provider value={queue}>{children}</QueueContext.Provider>
    </PlayerContext.Provider>
  );
}

/** Accès aux commandes de lecture et de file. À utiliser sous `PlayerProvider`. */
export function usePlayer(): PlayerActions & QueueActions {
  const actions = useContext(PlayerContext);
  if (!actions) {
    throw new Error('usePlayer doit être utilisé dans un <PlayerProvider>.');
  }
  return actions;
}

/** Snapshot réactif de la file de lecture. À utiliser sous `PlayerProvider`. */
export function useQueue(): QueueState {
  const queue = useContext(QueueContext);
  if (!queue) {
    throw new Error('useQueue doit être utilisé dans un <PlayerProvider>.');
  }
  return queue;
}
