// Stub web de react-native-track-player.
//
// Fuoco est Android only (cf. PROJET.md) : il n'y a pas de lecture sur le web. La vraie
// implémentation web de RNTP tire `shaka-player` et casse le prerender statique d'Expo
// (`Class extends value undefined`). Tout le code lecteur est déjà gardé par
// `Platform.OS !== 'web'`, donc rien de tout ceci ne s'exécute réellement sur le web : ce
// stub existe uniquement pour que `expo export --platform web` (notre check de bundle) passe.
//
// Aliasé à la place du paquet npm sur le web via metro.config.js. Les types, eux, restent
// résolus depuis le vrai paquet (tsc n'utilise pas cet alias), donc l'API tapée reste juste.

const noop = () => {};
const asyncNoop = async () => {};

export const State = {
  None: 'none',
  Ready: 'ready',
  Playing: 'playing',
  Paused: 'paused',
  Stopped: 'stopped',
  Buffering: 'buffering',
  Loading: 'loading',
};
export const Capability = {};
export const Event = {};
export const RepeatMode = { Off: 0, Track: 1, Queue: 2 };
export const AppKilledPlaybackBehavior = {
  ContinuePlayback: 'continue-playback',
  StopPlaybackAndRemoveNotification: 'stop-playback-and-remove-notification',
  PausePlayback: 'pause-playback',
};

export const useActiveTrack = () => undefined;
export const useIsPlaying = () => ({ playing: false, bufferingDuringPlay: false });
export const useProgress = () => ({ position: 0, duration: 0, buffered: 0 });

const TrackPlayer = {
  registerPlaybackService: noop,
  setupPlayer: asyncNoop,
  updateOptions: asyncNoop,
  setRepeatMode: asyncNoop,
  addEventListener: () => ({ remove: noop }),
  play: asyncNoop,
  pause: asyncNoop,
  stop: asyncNoop,
  reset: asyncNoop,
  seekTo: asyncNoop,
  skip: asyncNoop,
  skipToNext: asyncNoop,
  skipToPrevious: asyncNoop,
  setQueue: asyncNoop,
  add: asyncNoop,
  remove: asyncNoop,
  move: asyncNoop,
  getQueue: async () => [],
  getActiveTrackIndex: async () => undefined,
  getPlaybackState: async () => ({ state: State.None }),
};

export default TrackPlayer;
