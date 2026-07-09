import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import TrackPlayer, { Event, RepeatMode, State, type Track } from 'react-native-track-player';

import { type LocalTrack } from '@/library/useAudioLibrary';
import * as db from '@/library/db';
import { setPlayContext, type PlayContext } from './playRecorder';
import { ensurePlayerReady } from './setup';
import { resolvePlayerTracks } from './track';
import { planMoves, restoreOrder, shuffleAfter } from './shuffle';
import { smartPrevious } from './controls';
import { requestNotificationPermission } from './notifPermission';

/** Correspondance `RepeatMode` ↔ valeur persistée (`app_settings`). */
function repeatFromSetting(value: string | null): RepeatMode {
  if (value === 'queue') {
    return RepeatMode.Queue;
  }
  if (value === 'track') {
    return RepeatMode.Track;
  }
  return RepeatMode.Off;
}

function repeatToSetting(mode: RepeatMode): string {
  if (mode === RepeatMode.Queue) {
    return 'queue';
  }
  if (mode === RepeatMode.Track) {
    return 'track';
  }
  return 'off';
}

/** Cycle des modes de répétition : Off → File → Piste → Off. */
function nextRepeat(mode: RepeatMode): RepeatMode {
  if (mode === RepeatMode.Off) {
    return RepeatMode.Queue;
  }
  if (mode === RepeatMode.Queue) {
    return RepeatMode.Track;
  }
  return RepeatMode.Off;
}

/** Commandes de lecture exposées à l'UI. L'état réactif, lui, passe par `usePlayback`. */
export type PlayerActions = {
  /**
   * Charge `tracks` comme file de lecture et démarre à l'index `startIndex`.
   * Les titres dont l'URI est introuvable sont ignorés ; l'index de départ est réaligné
   * sur le titre réellement tapé pour rester juste malgré ces trous.
   * `context` = provenance du lancement, enregistrée avec l'historique d'écoute (#25).
   */
  playQueue: (tracks: LocalTrack[], startIndex: number, context?: PlayContext) => Promise<void>;
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
  /** Vide la file en conservant la piste en cours (ou tout, si rien ne joue). */
  clearQueue: () => Promise<void>;
};

/** Instantané réactif de la file, pour l'affichage. */
export type QueueState = {
  tracks: Track[];
  /** Index de la piste en cours dans `tracks`, ou `undefined` si la file est vide. */
  activeIndex: number | undefined;
};

/** Mode de lecture : répétition + lecture aléatoire (finition Phase 1). */
export type PlaybackMode = {
  /** Mode de répétition courant (Off / File / Piste). */
  repeatMode: RepeatMode;
  /** La lecture aléatoire est-elle active ? */
  shuffle: boolean;
  /** Passe au mode de répétition suivant (Off → File → Piste → Off) et le persiste. */
  cycleRepeat: () => void;
  /** Fixe directement le mode de répétition (écran Réglages) et le persiste. */
  setRepeat: (mode: RepeatMode) => void;
  /** Active/désactive la lecture aléatoire (réordonne la file en conséquence) et la persiste. */
  toggleShuffle: () => void;
};

const PlayerContext = createContext<(PlayerActions & QueueActions) | null>(null);
const QueueContext = createContext<QueueState | null>(null);
const PlaybackModeContext = createContext<PlaybackMode | null>(null);

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

  // Mode de lecture (finition Phase 1). État réactif pour l'UI + refs lues hors rendu dans les
  // handlers (évite les closures périmées). Valeurs initiales relues depuis les préférences.
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() =>
    repeatFromSetting(db.getSetting('playback.repeat'))
  );
  const [shuffle, setShuffle] = useState<boolean>(() => db.getSetting('playback.shuffle') === '1');
  const shuffleRef = useRef(shuffle);
  // Ordre de la file avant activation du shuffle, pour pouvoir le restaurer à la désactivation.
  const originalOrderRef = useRef<string[] | null>(null);

  // Sérialise les opérations qui touchent à la file. Les mutations rapides (déplacements
  // successifs) s'enchaînent alors strictement, sans s'entrelacer : chaque `refreshQueue` lit
  // donc un état natif stable, et le snapshot reste cohérent (l'index pointe bien sur sa piste).
  const opChain = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const run = opChain.current.then(op, op);
    // On avale les erreurs sur la chaîne interne pour qu'un échec ne bloque pas les ops suivantes ;
    // l'appelant, lui, reçoit la vraie promesse (`run`) et peut réagir à l'erreur.
    opChain.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  // Numéro de séquence : seul le dernier `refreshQueue` déclenché a le droit de publier son
  // résultat, pour qu'une lecture native plus lente à revenir n'écrase pas un snapshot plus récent.
  const refreshSeq = useRef(0);

  // Recharge le snapshot de la file depuis le lecteur (source de vérité).
  const refreshQueue = useCallback(async () => {
    if (!(await ensurePlayerReady())) {
      return;
    }
    const seq = ++refreshSeq.current;
    const [tracks, activeIndex] = await Promise.all([
      TrackPlayer.getQueue(),
      TrackPlayer.getActiveTrackIndex(),
    ]);
    if (seq !== refreshSeq.current) {
      return; // Un refresh plus récent a été demandé entre-temps : ce résultat est périmé.
    }
    setQueue({ tracks, activeIndex });
  }, []);

  useEffect(() => {
    void enqueue(refreshQueue);

    // La piste active change sur skip, avancement naturel et remplacement de file : autant de
    // moments où le snapshot doit se resynchroniser. On passe par la même file d'opérations pour
    // ne pas lire l'état natif au milieu d'une mutation en cours.
    const sub = TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => {
      void enqueue(refreshQueue);
    });
    // Fin de file (hors répétition) : resynchronise le snapshot pour que mini-player et écran
    // Lecture reflètent l'état arrêté au lieu de rester figés sur la dernière piste « en cours ».
    const endSub = TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
      void enqueue(refreshQueue);
    });
    return () => {
      sub.remove();
      endSub.remove();
    };
  }, [enqueue, refreshQueue]);

  // Applique le mode de répétition persisté une fois le lecteur prêt (le défaut RNTP est `Off`).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await ensurePlayerReady())) {
        return;
      }
      const mode = repeatFromSetting(db.getSetting('playback.repeat'));
      await TrackPlayer.setRepeatMode(mode);
      if (!cancelled) {
        setRepeatMode(mode);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const playQueue = useCallback(
    (tracks: LocalTrack[], startIndex: number, context?: PlayContext) =>
      enqueue(async () => {
        if (!(await ensurePlayerReady()) || tracks.length === 0) {
          return;
        }
        // Posé avant `setQueue` : le `PlaybackActiveTrackChanged` qui suit ouvre la session
        // d'écoute avec cette provenance (#25).
        setPlayContext(context ?? null);
        // Android 13+ : sans elle, la notification média est masquée. Non bloquant (la lecture
        // démarre pendant que le dialogue système s'affiche), demandé au premier vrai besoin.
        requestNotificationPermission();
        const targetId = tracks[startIndex]?.id;
        const resolved = await resolvePlayerTracks(tracks);
        if (resolved.length === 0) {
          return;
        }
        const resumeIndex = Math.max(
          0,
          resolved.findIndex((track) => track.id === targetId)
        );

        // Ordre final calculé AVANT de charger la file. En shuffle, on mélange la suite du titre
        // tapé (gardé en place par `shuffleAfter`, donc toujours à `resumeIndex`), puis on charge
        // la file déjà mélangée. On ne réordonne JAMAIS après `skip`/`play` : enchaîner des `move`
        // sur une file en cours de transition (ExoPlayer encore en buffering) faisait dériver la
        // piste réellement lue vers un titre aléatoire de la file mélangée.
        let finalTracks = resolved;
        if (shuffleRef.current) {
          const ids = resolved.map((t) => String(t.id));
          originalOrderRef.current = ids;
          const byId = new Map(resolved.map((t) => [String(t.id), t]));
          finalTracks = shuffleAfter(ids, resumeIndex)
            .map((id) => byId.get(id))
            .filter((track): track is Track => track !== undefined);
        }

        await TrackPlayer.setQueue(finalTracks);
        await TrackPlayer.skip(resumeIndex);
        await TrackPlayer.play();
        await refreshQueue();
      }),
    [enqueue, refreshQueue]
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
  // « Précédent » intelligent : > 3 s de lecture = redémarrer la piste, sinon reculer.
  const skipToPrevious = useCallback(() => void smartPrevious().catch(() => {}), []);
  const seekTo = useCallback((seconds: number) => void TrackPlayer.seekTo(seconds), []);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((prev) => {
      const next = nextRepeat(prev);
      db.setSetting('playback.repeat', repeatToSetting(next));
      void ensurePlayerReady().then((ok) => {
        if (ok) {
          void TrackPlayer.setRepeatMode(next);
        }
      });
      return next;
    });
  }, []);

  const setRepeat = useCallback((mode: RepeatMode) => {
    setRepeatMode(mode);
    db.setSetting('playback.repeat', repeatToSetting(mode));
    void ensurePlayerReady().then((ok) => {
      if (ok) {
        void TrackPlayer.setRepeatMode(mode);
      }
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    const next = !shuffleRef.current;
    shuffleRef.current = next;
    setShuffle(next);
    db.setSetting('playback.shuffle', next ? '1' : '0');
    void enqueue(async () => {
      if (!(await ensurePlayerReady())) {
        return;
      }
      const [tracks, activeIndexRaw] = await Promise.all([
        TrackPlayer.getQueue(),
        TrackPlayer.getActiveTrackIndex(),
      ]);
      const currentIds = tracks.map((t) => String(t.id));
      if (currentIds.length === 0) {
        return;
      }
      const activeIndex = activeIndexRaw ?? -1;
      let target: string[];
      if (next) {
        // Activation : on garde l'ordre courant comme référence, puis on mélange la suite.
        originalOrderRef.current = currentIds;
        target = shuffleAfter(currentIds, activeIndex);
      } else {
        // Désactivation : on restaure l'ordre d'origine (ids disparus ignorés, ajoutés en fin).
        target = restoreOrder(currentIds, originalOrderRef.current ?? currentIds);
      }
      for (const [from, to] of planMoves(currentIds, target)) {
        await TrackPlayer.move(from, to);
      }
      await refreshQueue();
    });
  }, [enqueue, refreshQueue]);

  const addToQueue = useCallback(
    (tracks: LocalTrack[]) =>
      enqueue(async () => {
        if (!(await ensurePlayerReady())) {
          return;
        }
        const resolved = await resolvePlayerTracks(tracks);
        if (resolved.length === 0) {
          return;
        }
        await TrackPlayer.add(resolved);
        await refreshQueue();
      }),
    [enqueue, refreshQueue]
  );

  const playNext = useCallback(
    (tracks: LocalTrack[]) =>
      enqueue(async () => {
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
      }),
    [enqueue, refreshQueue]
  );

  const removeFromQueue = useCallback(
    (index: number) =>
      enqueue(async () => {
        if (!(await ensurePlayerReady())) {
          return;
        }
        await TrackPlayer.remove(index);
        await refreshQueue();
      }),
    [enqueue, refreshQueue]
  );

  const moveInQueue = useCallback(
    (fromIndex: number, toIndex: number) =>
      enqueue(async () => {
        if (!(await ensurePlayerReady())) {
          return;
        }
        await TrackPlayer.move(fromIndex, toIndex);
        await refreshQueue();
      }),
    [enqueue, refreshQueue]
  );

  const skipToIndex = useCallback(
    (index: number) =>
      enqueue(async () => {
        if (!(await ensurePlayerReady())) {
          return;
        }
        await TrackPlayer.skip(index);
        await TrackPlayer.play();
        await refreshQueue();
      }),
    [enqueue, refreshQueue]
  );

  const clearQueue = useCallback(
    () =>
      enqueue(async () => {
        if (!(await ensurePlayerReady())) {
          return;
        }
        const [tracks, activeIndex] = await Promise.all([
          TrackPlayer.getQueue(),
          TrackPlayer.getActiveTrackIndex(),
        ]);
        if (tracks.length === 0) {
          return;
        }
        if (activeIndex == null) {
          // Rien en lecture : on remet le lecteur à zéro.
          await TrackPlayer.reset();
        } else {
          // On retire tout sauf la piste en cours (passées ET à venir), en un seul appel natif.
          const others = tracks.map((_t, i) => i).filter((i) => i !== activeIndex);
          if (others.length > 0) {
            await TrackPlayer.remove(others);
          }
        }
        await refreshQueue();
      }),
    [enqueue, refreshQueue]
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
      clearQueue,
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
      clearQueue,
    ]
  );

  const mode = useMemo<PlaybackMode>(
    () => ({ repeatMode, shuffle, cycleRepeat, setRepeat, toggleShuffle }),
    [repeatMode, shuffle, cycleRepeat, setRepeat, toggleShuffle]
  );

  return (
    <PlayerContext.Provider value={actions}>
      <PlaybackModeContext.Provider value={mode}>
        <QueueContext.Provider value={queue}>{children}</QueueContext.Provider>
      </PlaybackModeContext.Provider>
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

/** Mode de lecture (répétition + shuffle). À utiliser sous `PlayerProvider`. */
export function usePlaybackMode(): PlaybackMode {
  const mode = useContext(PlaybackModeContext);
  if (!mode) {
    throw new Error('usePlaybackMode doit être utilisé dans un <PlayerProvider>.');
  }
  return mode;
}
