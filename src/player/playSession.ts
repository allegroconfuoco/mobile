import type { Track } from 'react-native-track-player';

/**
 * Cœur **pur** de l'enregistreur d'écoutes (issue #25) — aucune dépendance runtime (seul le type
 * `Track` de RNTP est importé, effacé à la compilation), donc testable au harnais tsx. Le câblage
 * réel (base, horloge, incognito) vit dans `playRecorder.ts`.
 *
 * Une **session** = une piste active. Le temps écouté est le **cumul des ticks de progression**
 * (1 s, émis uniquement en lecture, cf. `setup.ts`) : robuste aux seeks, aucune position de fin à
 * interpréter. La session est écrite à chaque moment « flushable » (pause, fin de file) et
 * clôturée au changement de piste — toujours sous le **même id UUIDv7**, donc l'upsert en base
 * réécrit la ligne au lieu de la dupliquer (pause + reprise = un seul événement).
 */

/** Provenance d'un lancement de lecture (métrique « contexte d'écoute » de #25). */
export type PlayContext =
  'library' | 'search' | 'album' | 'artist' | 'favorites' | 'queue' | `playlist:${string}`;

/** Un événement d'écoute prêt à persister — sans l'id partagé, résolu par la couche base. */
export type PlayDraft = {
  eventId: string;
  localTrackId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  startedAt: number;
  playedMs: number;
  durationMs: number | null;
  skipped: boolean;
  completed: boolean;
  context: string | null;
};

/** Effets injectés (le harnais les remplace par des espions). */
export type RecorderDeps = {
  now: () => number;
  newId: () => string;
  /** Mode « écoute privée » : quand actif, aucun flush n'écrit (la session continue en mémoire). */
  isIncognito: () => boolean;
  persist: (draft: PlayDraft) => void;
};

export type PlayRecorder = {
  /** Pose le contexte du prochain lancement (appelé par `playQueue`). */
  setContext: (context: PlayContext | null) => void;
  /** Changement de piste active : clôt la session en cours, en ouvre une pour `next`. */
  onTrackChanged: (next: Track | undefined) => void;
  /** Tick de progression (1 s, lecture en cours) : cumule le temps écouté. */
  onProgressTick: (durationSeconds?: number) => void;
  /** Pause/arrêt : écrit l'état courant sans clore la session (une reprise cumulera dessus). */
  onPause: () => void;
  /** Fin de file (hors répétition) : clôt et écrit la session. */
  onQueueEnded: () => void;
};

// En deçà, la session est du bruit (mauvais tap, skip immédiat) : jamais écrite.
const MIN_SESSION_MS = 5_000;
// Seuil de skip classique (< 30 s écoutées), cf. #25 « données pour l'algorithme ».
const SKIP_THRESHOLD_MS = 30_000;
// Complétion : ≥ 90 % de la durée écoutée (tolère les fins fondues / outros coupées).
const COMPLETION_RATIO = 0.9;

type Session = {
  eventId: string;
  localTrackId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  startedAt: number;
  playedMs: number;
  durationMs: number | null;
  context: string | null;
};

export function createPlayRecorder(deps: RecorderDeps): PlayRecorder {
  let session: Session | null = null;
  let context: PlayContext | null = null;

  const flush = (final: boolean): void => {
    const current = session;
    if (final) {
      session = null;
    }
    if (!current || current.playedMs < MIN_SESSION_MS || deps.isIncognito()) {
      return;
    }
    deps.persist({
      eventId: current.eventId,
      localTrackId: current.localTrackId,
      title: current.title,
      artist: current.artist,
      album: current.album,
      startedAt: current.startedAt,
      playedMs: current.playedMs,
      durationMs: current.durationMs,
      skipped: current.playedMs < SKIP_THRESHOLD_MS,
      completed:
        current.durationMs !== null && current.playedMs >= current.durationMs * COMPLETION_RATIO,
      context: current.context,
    });
  };

  return {
    setContext(next) {
      context = next;
    },

    onTrackChanged(next) {
      flush(true);
      // `toPlayerTrack` pose toujours l'id media-store sur la piste ; sans id (piste étrangère
      // au modèle, ne devrait pas arriver), on n'enregistre rien.
      if (next?.id == null) {
        return;
      }
      session = {
        eventId: deps.newId(),
        localTrackId: String(next.id),
        title: typeof next.title === 'string' ? next.title : null,
        artist: typeof next.artist === 'string' ? next.artist : null,
        album: typeof next.album === 'string' ? next.album : null,
        startedAt: deps.now(),
        playedMs: 0,
        durationMs: typeof next.duration === 'number' ? Math.round(next.duration * 1000) : null,
        context,
      };
    },

    onProgressTick(durationSeconds) {
      if (!session) {
        return;
      }
      session.playedMs += 1_000;
      // La durée manque parfois au chargement (tag absent) : le tick de progression la connaît.
      if (session.durationMs === null && durationSeconds != null && durationSeconds > 0) {
        session.durationMs = Math.round(durationSeconds * 1000);
      }
    },

    onPause() {
      flush(false);
    },

    onQueueEnded() {
      flush(true);
    },
  };
}
