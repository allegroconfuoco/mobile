// Stub web de @rntp/player.
//
// Fuoco est Android only (cf. PROJET.md) : il n'y a pas de lecture sur le web. L'implémentation
// web de @rntp/player attend `shaka-player` (peer dependency optionnelle, non installée). Tout le
// code lecteur est déjà gardé par `Platform.OS !== 'web'`, donc rien de tout ceci ne s'exécute
// réellement sur le web : ce stub existe uniquement pour que `expo export --platform web`
// (notre check de bundle) passe.
//
// Aliasé à la place du paquet npm sur le web via metro.config.js. Les types, eux, restent
// résolus depuis le vrai paquet (tsc n'utilise pas cet alias), donc l'API tapée reste juste.
// L'API v5 est majoritairement synchrone : les stubs renvoient des valeurs, pas des promesses.

const noop = () => {};

export const PlaybackState = {
  Idle: 'idle',
  Ready: 'ready',
  Buffering: 'buffering',
  Ended: 'ended',
  Error: 'error',
};
export const RepeatMode = { Off: 'off', One: 'one', All: 'all' };
export const PlayerCommand = {
  Seek: 'seek',
  PlayPause: 'playPause',
  Next: 'next',
  Previous: 'previous',
  Stop: 'stop',
  SkipForward: 'skipForward',
  SkipBackward: 'skipBackward',
};
export const Event = {};

export const useActiveMediaItem = () => null;
export const useIsPlaying = () => false;
export const usePlaybackState = () => PlaybackState.Idle;
export const useProgress = () => ({ position: 0, duration: 0, buffered: 0, cached: 0 });

const TrackPlayer = {
  setupPlayer: noop,
  destroy: noop,
  registerBackgroundEventHandler: noop,
  addEventListener: () => ({ remove: noop }),
  setCommands: noop,
  play: noop,
  pause: noop,
  stop: noop,
  seekTo: noop,
  seekBy: noop,
  skipToNext: noop,
  skipToPrevious: noop,
  skipToIndex: noop,
  retry: noop,
  setMediaItem: noop,
  setMediaItems: noop,
  addMediaItem: noop,
  addMediaItems: noop,
  insertMediaItem: noop,
  insertMediaItems: noop,
  removeMediaItem: noop,
  removeMediaItems: noop,
  replaceMediaItem: noop,
  moveMediaItem: noop,
  clear: noop,
  updateMetadata: noop,
  getPlaybackState: () => PlaybackState.Idle,
  isPlaying: () => false,
  getProgress: () => ({ position: 0, duration: 0, buffered: 0, cached: 0 }),
  getActiveMediaItem: () => null,
  getActiveMediaItemIndex: () => null,
  getQueue: () => [],
  getRepeatMode: () => RepeatMode.Off,
  setRepeatMode: noop,
  isShuffleEnabled: () => false,
  setShuffleEnabled: noop,
  sleepAfterTime: noop,
  sleepAfterMediaItemAtIndex: noop,
  getSleepTimer: () => null,
  cancelSleepTimer: noop,
};

export default TrackPlayer;
