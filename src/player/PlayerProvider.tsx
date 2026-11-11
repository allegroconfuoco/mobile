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
import { useLibrary } from '@/library/LibraryProvider';
import * as db from '@/library/db';
import { setPlayContext, type PlayContext } from './playRecorder';
import { setQueueSource, type QueueSource } from './queueSource';
import { loadResumePoint } from './resumeState';
import { ensurePlayerReady, reassertCommands } from './setup';
import { toMediaItems } from './track';
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
   * Charge `tracks` comme file de lecture et démarre à l'index `startIndex`. **Synchrone** : la
   * file se construit depuis la bibliothèque en mémoire, le son part dans la foulée du tap.
   * `context` = provenance pour l'historique d'écoute ; `source` = d'où vient la file, pour y
   * retourner depuis l'écran Lecture (playlist, album, artiste).
   */
  playQueue: (
    tracks: LocalTrack[],
    startIndex: number,
    context?: PlayContext,
    source?: QueueSource | null
  ) => void;
  togglePlayPause: () => void;
  skipToNext: () => void;
  /** « Précédent » intelligent (> 3 s de lecture = redémarrer la piste), comme la notification. */
  skipToPrevious: () => void;
  /** Position absolue en secondes. */
  seekTo: (seconds: number) => void;
};

/** Gestion de la file de lecture : mutations + saut direct à un index. */
export type QueueActions = {
  /** Ajoute `tracks` à la fin de la file (sans changer la lecture en cours). */
  addToQueue: (tracks: LocalTrack[]) => void;
  /** Insère `tracks` juste après la piste courante (« Lire ensuite »). */
  playNext: (tracks: LocalTrack[]) => void;
  /** Retire la piste à `index` de la file. */
  removeFromQueue: (index: number) => void;
  /** Déplace la piste de `fromIndex` vers `toIndex` (réordonnancement). */
  moveInQueue: (fromIndex: number, toIndex: number) => void;
  /** Saute à la piste `index` de la file et lance la lecture. */
  skipToIndex: (index: number) => void;
  /** Vide la file en conservant la piste en cours (ou tout, si rien ne joue). */
  clearQueue: () => void;
};

/** Instantané réactif de la file, pour l'affichage. */
export type QueueState = {
  tracks: MediaItem[];
  /** Index de la piste en cours dans `tracks`, ou `undefined` si la file est vide. */
  activeIndex: number | undefined;
  /**
   * Non nul quand la file affichée est la **session restaurée** de la dernière utilisation, pas
   * encore chargée dans le lecteur natif : c'est la position (ms) à laquelle la lecture reprendra.
   * `null` dès que la file est réellement dans le lecteur.
   */
  restoredPositionMs: number | null;
};

/** Mode de lecture : répétition + lecture aléatoire. */
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

const EMPTY_QUEUE: QueueState = { tracks: [], activeIndex: undefined, restoredPositionMs: null };

/** File réellement chargée dans le lecteur natif (vide avant le setup, ou sur le web). */
function readNativeQueue(): QueueState {
  if (Platform.OS === 'web') {
    return EMPTY_QUEUE;
  }
  try {
    return {
      tracks: TrackPlayer.getQueue(),
      activeIndex: TrackPlayer.getActiveMediaItemIndex() ?? undefined,
      restoredPositionMs: null,
    };
  } catch {
    return EMPTY_QUEUE;
  }
}

/**
 * Reconstruit la dernière session d'écoute depuis le point de reprise (ids + index + position),
 * résolue contre la bibliothèque courante. Les fichiers disparus depuis sont omis, et l'index se
 * recale sur la piste interrompue si elle est encore là, sinon sur la suivante disponible.
 */
function readRestoredQueue(tracksById: Map<string, LocalTrack>): QueueState | null {
  const point = loadResumePoint();
  if (!point) {
    return null;
  }
  const locals: LocalTrack[] = [];
  let index = -1;
  for (let i = 0; i < point.trackIds.length; i++) {
    const track = tracksById.get(point.trackIds[i]);
    if (!track) {
      continue;
    }
    if (index === -1 && i >= point.index) {
      index = locals.length;
    }
    locals.push(track);
  }
  const tracks = toMediaItems(locals);
  if (tracks.length === 0) {
    return null;
  }
  const activeIndex = Math.min(Math.max(index, 0), tracks.length - 1);
  // Reprendre à la position n'a de sens que sur la piste réellement interrompue.
  const exact = tracks[activeIndex].mediaId === point.trackIds[point.index];
  return { tracks, activeIndex, restoredPositionMs: exact ? Math.max(0, point.positionMs) : 0 };
}

/**
 * Monte le lecteur et fournit ses commandes à l'arbre.
 *
 * L'API @rntp/player v5 est **synchrone** (TurboModule) : les lectures d'état (`getQueue`,
 * `getActiveMediaItemIndex`) sont atomiques du point de vue JS, et le natif (MediaController
 * Media3) est l'unique source de vérité. Les commandes le sont donc aussi : aucune ne renvoie de
 * promesse, le son part dans le même tour de boucle que le tap.
 *
 * **Session restaurée.** À l'ouverture, si le lecteur natif est vide, la file affichée est celle
 * de la dernière utilisation (cf. `resumeState`), à l'arrêt. Elle n'est *pas* chargée dans le
 * lecteur natif tant que l'utilisateur ne fait rien : charger une file, même en pause, réveille le
 * service média et sa notification, ce qu'on ne veut pas à chaque lancement. Elle est
 * « matérialisée » à la première commande (lecture, saut, ajout à la file).
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
  const { tracksById } = useLibrary();

  // Initialiseur paresseux : la file native si le lecteur tourne déjà (rechargement à chaud, ou
  // retour dans l'app pendant une lecture), sinon la session restaurée. La bibliothèque est
  // chargée de façon synchrone depuis SQLite, donc `tracksById` est déjà peuplé ici.
  const [queue, setQueue] = useState<QueueState>(() => {
    const native = readNativeQueue();
    if (native.tracks.length > 0) {
      return native;
    }
    return readRestoredQueue(tracksById) ?? EMPTY_QUEUE;
  });
  // Miroir de la file restaurée, lu par les commandes hors rendu. `null` = la file est native.
  const restoredRef = useRef<QueueState | null>(queue.restoredPositionMs !== null ? queue : null);

  // Mode de lecture. État réactif pour l'UI + refs lues hors rendu dans les
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
    // Tant que le natif est vide, la session restaurée reste affichée : les événements d'état du
    // lecteur (émis dès le setup) ne doivent pas l'effacer.
    if (tracks.length === 0 && restoredRef.current) {
      return;
    }
    restoredRef.current = null;
    const activeIndex = TrackPlayer.getActiveMediaItemIndex() ?? undefined;
    setQueue((prev) => {
      // Bail-out d'identité : `PlaybackStateChanged` (play/pause/buffer) rappelle ce refresh en
      // continu pendant la lecture ; sans comparaison, chaque appel posait un nouveau tableau et
      // re-rendait tous les consommateurs `useQueue` (et re-déclenchait la resync de la liste
      // réordonnable). Même séquence de `mediaId` + même piste active = snapshot inchangé.
      if (
        prev.restoredPositionMs === null &&
        prev.activeIndex === activeIndex &&
        prev.tracks.length === tracks.length &&
        prev.tracks.every((t, i) => t.mediaId === tracks[i].mediaId)
      ) {
        return prev;
      }
      return { tracks, activeIndex, restoredPositionMs: null };
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

  // Initialise le lecteur dès le montage plutôt qu'au premier tap : le setup (connexion au service
  // média) est ainsi déjà payé quand l'utilisateur lance un titre. Fait dans un effet, donc après
  // la première image. Le mode de répétition persisté est appliqué au passage (défaut `Off`).
  useEffect(() => {
    if (!ensurePlayerReady()) {
      return;
    }
    TrackPlayer.setRepeatMode(repeatFromSetting(db.getSetting('playback.repeat')));
    refreshQueue();
  }, [refreshQueue]);

  /**
   * Charge la session restaurée dans le lecteur natif, à l'index voulu, et rend la main.
   * Renvoie `false` s'il n'y avait rien à matérialiser (la file est déjà native) : l'appelant
   * exécute alors sa commande normalement.
   */
  const materialize = useCallback(
    (index?: number): boolean => {
      const restored = restoredRef.current;
      if (!restored || !ensurePlayerReady()) {
        return false;
      }
      restoredRef.current = null;
      // Le service tournait déjà avec sa propre file (connexion tardive du contrôleur) : c'est
      // elle qui fait foi.
      if (TrackPlayer.getQueue().length > 0) {
        refreshQueue();
        return false;
      }
      const resumeIndex = restored.activeIndex ?? 0;
      const target = index ?? resumeIndex;
      requestNotificationPermission();
      setPlayContext('resume');
      TrackPlayer.setMediaItems(restored.tracks, target);
      if (target === resumeIndex && (restored.restoredPositionMs ?? 0) > 0) {
        TrackPlayer.seekTo((restored.restoredPositionMs ?? 0) / 1000);
      }
      reassertCommands();
      return true;
    },
    [refreshQueue]
  );

  const playQueue = useCallback(
    (
      tracks: LocalTrack[],
      startIndex: number,
      context?: PlayContext,
      source?: QueueSource | null
    ) => {
      if (!ensurePlayerReady() || tracks.length === 0) {
        return;
      }
      const items = toMediaItems(tracks);
      if (items.length === 0) {
        return;
      }
      restoredRef.current = null;
      // Posés avant le chargement : le `MediaItemTransition` qui suit ouvre la session d'écoute
      // avec cette provenance.
      setPlayContext(context ?? null);
      setQueueSource(source ?? null);
      // Android 13+ : sans elle, la notification média est masquée. Non bloquant (la lecture
      // démarre pendant que le dialogue système s'affiche), demandé au premier vrai besoin.
      requestNotificationPermission();
      // Une piste sans URI a pu être omise : on réaligne l'index sur le titre réellement tapé.
      const targetId = tracks[startIndex]?.id;
      const resumeIndex = Math.max(
        0,
        items.findIndex((item) => item.mediaId === targetId)
      );

      // En shuffle, l'ordre final est calculé AVANT de charger la file : on mélange la suite du
      // titre tapé (gardé en place par `shuffleAfter`, donc toujours à `resumeIndex`), puis on
      // charge la file déjà mélangée.
      let finalItems = items;
      if (shuffleRef.current) {
        const ids = items.map((t) => t.mediaId ?? '');
        originalOrderRef.current = ids;
        const byId = new Map(items.map((t) => [t.mediaId ?? '', t]));
        finalItems = shuffleAfter(ids, resumeIndex)
          .map((id) => byId.get(id))
          .filter((item): item is MediaItem => item !== undefined);
      }

      TrackPlayer.setMediaItems(finalItems, resumeIndex);
      TrackPlayer.play();
      // Le contrôleur natif est forcément connecté ici : on re-pose les commandes distantes pour
      // rattraper une rediffusion perdue à l'init (bouton suivant absent de la notif, cf. setup.ts).
      reassertCommands();
      refreshQueue();
    },
    [refreshQueue]
  );

  const togglePlayPause = useCallback(() => {
    if (!ensurePlayerReady()) {
      return;
    }
    if (materialize()) {
      TrackPlayer.play();
      refreshQueue();
      return;
    }
    if (TrackPlayer.isPlaying()) {
      TrackPlayer.pause();
    } else {
      TrackPlayer.play();
    }
  }, [materialize, refreshQueue]);

  const skipToIndex = useCallback(
    (index: number) => {
      if (!ensurePlayerReady()) {
        return;
      }
      if (!materialize(index)) {
        TrackPlayer.skipToIndex(index);
      }
      TrackPlayer.play();
      refreshQueue();
    },
    [materialize, refreshQueue]
  );

  const skipToNext = useCallback(() => {
    if (!ensurePlayerReady()) {
      return;
    }
    const restored = restoredRef.current;
    if (restored) {
      // Session restaurée : « suivant » la matérialise directement sur la piste d'après.
      const next = (restored.activeIndex ?? 0) + 1;
      if (next < restored.tracks.length) {
        skipToIndex(next);
      }
      return;
    }
    TrackPlayer.skipToNext();
  }, [skipToIndex]);

  const skipToPrevious = useCallback(() => {
    if (!ensurePlayerReady()) {
      return;
    }
    const restored = restoredRef.current;
    if (restored) {
      skipToIndex(Math.max(0, (restored.activeIndex ?? 0) - 1));
      return;
    }
    TrackPlayer.skipToPrevious();
  }, [skipToIndex]);

  const seekTo = useCallback((seconds: number) => {
    if (!ensurePlayerReady()) {
      return;
    }
    const restored = restoredRef.current;
    if (restored) {
      // Rien n'est chargé : on déplace seulement le point où la lecture reprendra.
      const next = { ...restored, restoredPositionMs: Math.max(0, Math.round(seconds * 1000)) };
      restoredRef.current = next;
      setQueue(next);
      return;
    }
    TrackPlayer.seekTo(seconds);
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
    materialize();
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
  }, [materialize, refreshQueue]);

  const addToQueue = useCallback(
    (tracks: LocalTrack[]) => {
      if (!ensurePlayerReady()) {
        return;
      }
      const items = toMediaItems(tracks);
      if (items.length === 0) {
        return;
      }
      materialize();
      TrackPlayer.addMediaItems(items);
      refreshQueue();
    },
    [materialize, refreshQueue]
  );

  const playNext = useCallback(
    (tracks: LocalTrack[]) => {
      if (!ensurePlayerReady()) {
        return;
      }
      const items = toMediaItems(tracks);
      if (items.length === 0) {
        return;
      }
      materialize();
      // Sans piste active (file vide), on ajoute simplement à la fin.
      const activeIndex = TrackPlayer.getActiveMediaItemIndex();
      if (activeIndex != null) {
        TrackPlayer.insertMediaItems(activeIndex + 1, items);
      } else {
        TrackPlayer.addMediaItems(items);
      }
      refreshQueue();
    },
    [materialize, refreshQueue]
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      if (!ensurePlayerReady()) {
        return;
      }
      materialize();
      TrackPlayer.removeMediaItem(index);
      refreshQueue();
    },
    [materialize, refreshQueue]
  );

  const moveInQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!ensurePlayerReady()) {
        return;
      }
      materialize();
      TrackPlayer.moveMediaItem(fromIndex, toIndex);
      refreshQueue();
    },
    [materialize, refreshQueue]
  );

  const clearQueue = useCallback(() => {
    if (!ensurePlayerReady()) {
      return;
    }
    materialize();
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
  }, [materialize, refreshQueue]);

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
