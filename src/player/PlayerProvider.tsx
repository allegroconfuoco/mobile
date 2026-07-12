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
import { AppState, Platform } from 'react-native';
import TrackPlayer, { Event, RepeatMode, type MediaItem } from '@rntp/player';

import { type LocalTrack } from '@/library/useAudioLibrary';
import * as db from '@/library/db';
import { setPlayContext, type PlayContext } from './playRecorder';
import { ensurePlayerReady } from './setup';
import { resolvePlayerTracks } from './track';
import { planMoves, restoreOrder, shuffleAfter } from './shuffle';
import { requestNotificationPermission } from './notifPermission';

/** Correspondance `RepeatMode` ↔ valeur persistée (`app_settings`, clés historiques). */
function repeatFromSetting(value: string | null): RepeatMode {
  if (value === 'queue') {
    return RepeatMode.All;
  }
  if (value === 'track') {
    return RepeatMode.One;
  }
  return RepeatMode.Off;
}

function repeatToSetting(mode: RepeatMode): string {
  if (mode === RepeatMode.All) {
    return 'queue';
  }
  if (mode === RepeatMode.One) {
    return 'track';
  }
  return 'off';
}

/** Cycle des modes de répétition : Off → File → Piste → Off. */
function nextRepeat(mode: RepeatMode): RepeatMode {
  if (mode === RepeatMode.Off) {
    return RepeatMode.All;
  }
  if (mode === RepeatMode.All) {
    return RepeatMode.One;
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
  tracks: MediaItem[];
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
 * L'initialisation est paresseuse et idempotente (cf. `ensurePlayerReady`) : chaque action
 * s'assure que le lecteur est prêt avant d'agir, donc un tap très précoce n'est jamais perdu.
 *
 * L'API @rntp/player v5 est **synchrone** (TurboModule) : les lectures d'état (`getQueue`,
 * `getActiveMediaItemIndex`) sont atomiques du point de vue JS, et le natif (MediaController
 * Media3) est l'unique source de vérité — plus de chaîne de sérialisation ni de numéros de
 * séquence, la classe entière de bugs « snapshot désynchronisé » de l'alpha disparaît.
 *
 * On garde le **shuffle « physique » maison** (réordonnancement réel de la file) plutôt que le
 * `setShuffleEnabled` natif : celui-ci mélange l'ordre de LECTURE de Media3 sans toucher à
 * l'ordre de la file (`getQueue`), donc l'écran File et « À suivre » ne refléteraient plus ce
 * qui va vraiment se jouer.
 *
 * Deux contextes distincts pour éviter des rendus inutiles : les *actions* sont stables, tandis
 * que le *snapshot* de la file (`QueueState`) change à chaque mutation ou avancement de piste.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  // Initialiseur paresseux : au (re)montage, on relit l'état natif si le lecteur existe déjà
  // (rechargement à chaud pendant une lecture) — avant tout setup, les lectures natives
  // retombent proprement sur « file vide ». L'effet plus bas ne fait que s'abonner
  // (règle react-hooks/set-state-in-effect).
  const [queue, setQueue] = useState<QueueState>(() => {
    if (Platform.OS === 'web') {
      return { tracks: [], activeIndex: undefined };
    }
    try {
      return {
        tracks: TrackPlayer.getQueue(),
        activeIndex: TrackPlayer.getActiveMediaItemIndex() ?? undefined,
      };
    } catch {
      return { tracks: [], activeIndex: undefined };
    }
  });

  // Mode de lecture (finition Phase 1). État réactif pour l'UI + refs lues hors rendu dans les
  // handlers (évite les closures périmées). Valeurs initiales relues depuis les préférences.
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() =>
    repeatFromSetting(db.getSetting('playback.repeat'))
  );
  const [shuffle, setShuffle] = useState<boolean>(() => db.getSetting('playback.shuffle') === '1');
  const shuffleRef = useRef(shuffle);
  // Ordre de la file avant activation du shuffle, pour pouvoir le restaurer à la désactivation.
  const originalOrderRef = useRef<string[] | null>(null);

  // Recharge le snapshot de la file depuis le lecteur (source de vérité), en une passe synchrone.
  const refreshQueue = useCallback(() => {
    if (!ensurePlayerReady()) {
      return;
    }
    const tracks = TrackPlayer.getQueue();
    const activeIndex = TrackPlayer.getActiveMediaItemIndex() ?? undefined;
    setQueue((prev) => {
      // Bail-out d'identité : `PlaybackStateChanged` (play/pause/buffer) rappelle ce refresh en
      // continu pendant la lecture ; sans comparaison, chaque appel posait un nouveau tableau et
      // re-rendait tous les consommateurs `useQueue` (et re-déclenchait la resync de la liste
      // réordonnable). Même séquence de `mediaId` + même piste active = snapshot inchangé.
      if (
        prev.activeIndex === activeIndex &&
        prev.tracks.length === tracks.length &&
        prev.tracks.every((t, i) => t.mediaId === tracks[i].mediaId)
      ) {
        return prev;
      }
      return { tracks, activeIndex };
    });
  }, []);

  useEffect(() => {
    // Mutations de file (add/remove/move/set) et changements de piste active : autant de moments
    // où le snapshot doit se resynchroniser.
    const queueSub = TrackPlayer.addEventListener(Event.QueueChanged, refreshQueue);
    const transitionSub = TrackPlayer.addEventListener(Event.MediaItemTransition, refreshQueue);
    // Fin de file (hors répétition) : reflète l'état arrêté au lieu de rester figé.
    const stateSub = TrackPlayer.addEventListener(Event.PlaybackStateChanged, refreshQueue);
    // En arrière-plan, les événements partent vers le handler headless, pas ici : on relit
    // l'état natif au retour au premier plan (même motif que les hooks de la lib).
    const appStateSub = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        refreshQueue();
      }
    });
    return () => {
      queueSub.remove();
      transitionSub.remove();
      stateSub.remove();
      appStateSub.remove();
    };
  }, [refreshQueue]);

  // Applique le mode de répétition persisté une fois le lecteur prêt (le défaut est `Off`).
  useEffect(() => {
    if (!ensurePlayerReady()) {
      return;
    }
    TrackPlayer.setRepeatMode(repeatFromSetting(db.getSetting('playback.repeat')));
  }, []);

  // Un seul lancement en vol à la fois : si deux `playQueue` se chevauchent (la résolution des
  // URI est asynchrone), seul le plus récent a le droit de charger la file.
  const playSeq = useRef(0);

  const playQueue = useCallback(
    async (tracks: LocalTrack[], startIndex: number, context?: PlayContext) => {
      if (!ensurePlayerReady() || tracks.length === 0) {
        return;
      }
      const seq = ++playSeq.current;
      // Posé avant le chargement : le `MediaItemTransition` qui suit ouvre la session
      // d'écoute avec cette provenance (#25).
      setPlayContext(context ?? null);
      // Android 13+ : sans elle, la notification média est masquée. Non bloquant (la lecture
      // démarre pendant que le dialogue système s'affiche), demandé au premier vrai besoin.
      requestNotificationPermission();
      const targetId = tracks[startIndex]?.id;
      const resolved = await resolvePlayerTracks(tracks);
      if (resolved.length === 0 || seq !== playSeq.current) {
        return;
      }
      const resumeIndex = Math.max(
        0,
        resolved.findIndex((track) => track.mediaId === targetId)
      );

      // En shuffle, l'ordre final est calculé AVANT de charger la file : on mélange la suite du
      // titre tapé (gardé en place par `shuffleAfter`, donc toujours à `resumeIndex`), puis on
      // charge la file déjà mélangée.
      let finalTracks = resolved;
      if (shuffleRef.current) {
        const ids = resolved.map((t) => t.mediaId ?? '');
        originalOrderRef.current = ids;
        const byId = new Map(resolved.map((t) => [t.mediaId ?? '', t]));
        finalTracks = shuffleAfter(ids, resumeIndex)
          .map((id) => byId.get(id))
          .filter((track): track is MediaItem => track !== undefined);
      }

      TrackPlayer.setMediaItems(finalTracks, resumeIndex);
      TrackPlayer.play();
      refreshQueue();
    },
    [refreshQueue]
  );

  const togglePlayPause = useCallback(async () => {
    if (!ensurePlayerReady()) {
      return;
    }
    if (TrackPlayer.isPlaying()) {
      TrackPlayer.pause();
    } else {
      TrackPlayer.play();
    }
  }, []);

  const skipToNext = useCallback(() => {
    if (ensurePlayerReady()) {
      TrackPlayer.skipToNext();
    }
  }, []);
  // « Précédent » intelligent (> 3 s de lecture = redémarrer la piste) : natif en v5.
  const skipToPrevious = useCallback(() => {
    if (ensurePlayerReady()) {
      TrackPlayer.skipToPrevious();
    }
  }, []);
  const seekTo = useCallback((seconds: number) => {
    if (ensurePlayerReady()) {
      TrackPlayer.seekTo(seconds);
    }
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((prev) => {
      const next = nextRepeat(prev);
      db.setSetting('playback.repeat', repeatToSetting(next));
      if (ensurePlayerReady()) {
        TrackPlayer.setRepeatMode(next);
      }
      return next;
    });
  }, []);

  const setRepeat = useCallback((mode: RepeatMode) => {
    setRepeatMode(mode);
    db.setSetting('playback.repeat', repeatToSetting(mode));
    if (ensurePlayerReady()) {
      TrackPlayer.setRepeatMode(mode);
    }
  }, []);

  const toggleShuffle = useCallback(() => {
    const next = !shuffleRef.current;
    shuffleRef.current = next;
    setShuffle(next);
    db.setSetting('playback.shuffle', next ? '1' : '0');
    if (!ensurePlayerReady()) {
      return;
    }
    const currentIds = TrackPlayer.getQueue().map((t) => t.mediaId ?? '');
    if (currentIds.length === 0) {
      return;
    }
    const activeIndex = TrackPlayer.getActiveMediaItemIndex() ?? -1;
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
      TrackPlayer.moveMediaItem(from, to);
    }
    refreshQueue();
  }, [refreshQueue]);

  const addToQueue = useCallback(
    async (tracks: LocalTrack[]) => {
      if (!ensurePlayerReady()) {
        return;
      }
      const resolved = await resolvePlayerTracks(tracks);
      if (resolved.length === 0) {
        return;
      }
      TrackPlayer.addMediaItems(resolved);
      refreshQueue();
    },
    [refreshQueue]
  );

  const playNext = useCallback(
    async (tracks: LocalTrack[]) => {
      if (!ensurePlayerReady()) {
        return;
      }
      const resolved = await resolvePlayerTracks(tracks);
      if (resolved.length === 0) {
        return;
      }
      // Sans piste active (file vide), on ajoute simplement à la fin.
      const activeIndex = TrackPlayer.getActiveMediaItemIndex();
      if (activeIndex != null) {
        TrackPlayer.insertMediaItems(activeIndex + 1, resolved);
      } else {
        TrackPlayer.addMediaItems(resolved);
      }
      refreshQueue();
    },
    [refreshQueue]
  );

  const removeFromQueue = useCallback(
    async (index: number) => {
      if (!ensurePlayerReady()) {
        return;
      }
      TrackPlayer.removeMediaItem(index);
      refreshQueue();
    },
    [refreshQueue]
  );

  const moveInQueue = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!ensurePlayerReady()) {
        return;
      }
      TrackPlayer.moveMediaItem(fromIndex, toIndex);
      refreshQueue();
    },
    [refreshQueue]
  );

  const skipToIndex = useCallback(
    async (index: number) => {
      if (!ensurePlayerReady()) {
        return;
      }
      TrackPlayer.skipToIndex(index);
      TrackPlayer.play();
      refreshQueue();
    },
    [refreshQueue]
  );

  const clearQueue = useCallback(async () => {
    if (!ensurePlayerReady()) {
      return;
    }
    const length = TrackPlayer.getQueue().length;
    if (length === 0) {
      return;
    }
    const activeIndex = TrackPlayer.getActiveMediaItemIndex();
    if (activeIndex == null) {
      // Rien en lecture : on remet le lecteur à zéro.
      TrackPlayer.clear();
    } else {
      // On retire tout sauf la piste en cours, par plages [from, to) : d'abord APRÈS elle,
      // puis AVANT (dans cet ordre — retirer avant décalerait l'index de la piste en cours).
      if (activeIndex + 1 < length) {
        TrackPlayer.removeMediaItems(activeIndex + 1, length);
      }
      if (activeIndex > 0) {
        TrackPlayer.removeMediaItems(0, activeIndex);
      }
    }
    refreshQueue();
  }, [refreshQueue]);

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
