import TrackPlayer from '@rntp/player';

import * as db from '@/library/db';

/**
 * Point de reprise **local** : de quoi rouvrir l'app et retrouver exactement l'écoute d'avant —
 * la piste, la seconde, et **toute la file d'attente** dans l'ordre.
 *
 * Pourquoi un stockage à part : la file vit uniquement dans le lecteur natif (Media3), qui meurt
 * avec le process ; `PlayerProvider` ne fait que relire cet état natif au montage. Sans ce
 * miroir en base, tuer l'app perdait la file entière, et la « reprise » ne pouvait proposer que
 * la piste seule.
 *
 * Le point de reprise est **purement local** (une clé `app_settings`) : rien n'est poussé ni lu
 * côté serveur. Le handoff inter-appareils de l'issue #25 a été retiré — c'était une complexité
 * de synchro pour un scénario qu'on n'utilise pas.
 */

/** Clé `app_settings` du point de reprise (JSON `ResumePoint`). */
const RESUME_KEY = 'playback.session';
/** Clé `app_settings` du `updatedAt` rejeté par l'utilisateur (croix sur la carte). */
const DISMISSED_KEY = 'playback.resumeDismissedAt';

/**
 * Écriture au plus toutes les 5 s : le lecteur émet un tick de progression par seconde, et la
 * seule chose qui bouge entre deux ticks est la position — 5 s de perte au pire sur un kill brutal.
 * Les moments décisifs (pause, changement de piste, fin de file) écrivent, eux, sans attendre.
 */
const THROTTLE_MS = 5_000;

export type ResumePoint = {
  /** Ids media-store de toute la file, dans l'ordre de lecture. */
  trackIds: string[];
  /** Index de la piste active dans `trackIds`. */
  index: number;
  positionMs: number;
  /** Horodatage de la dernière écriture — sert à la fraîcheur et au jeton de rejet. */
  updatedAt: number;
};

let lastWriteAt = 0;

/**
 * Photographie l'écoute en cours dans `app_settings`.
 *
 * `throttled` est vrai pour les appels à la seconde (ticks de progression) et faux pour les
 * moments décisifs. Une file vide efface le point de reprise : il n'y a plus rien à reprendre.
 */
export function captureResumePoint(positionMs: number, throttled: boolean): void {
  const now = Date.now();
  if (throttled && now - lastWriteAt < THROTTLE_MS) {
    return;
  }
  let queue;
  let activeIndex;
  try {
    queue = TrackPlayer.getQueue();
    activeIndex = TrackPlayer.getActiveMediaItemIndex();
  } catch {
    return; // Lecteur pas encore prêt : rien de fiable à photographier.
  }
  if (queue.length === 0 || activeIndex == null || activeIndex < 0) {
    return;
  }
  // Une piste sans `mediaId` n'est pas résoluble au retour : on abandonne la photo plutôt que
  // d'enregistrer une file trouée qui décalerait l'index.
  const trackIds: string[] = [];
  for (const item of queue) {
    if (typeof item.mediaId !== 'string' || item.mediaId === '') {
      return;
    }
    trackIds.push(item.mediaId);
  }
  lastWriteAt = now;
  const point: ResumePoint = { trackIds, index: activeIndex, positionMs, updatedAt: now };
  db.setSetting(RESUME_KEY, JSON.stringify(point));
}

/** Relit le point de reprise, ou `null` s'il n'y en a pas (ou s'il est illisible). */
export function loadResumePoint(): ResumePoint | null {
  const raw = db.getSetting(RESUME_KEY);
  if (!raw) {
    return null;
  }
  let point: ResumePoint;
  try {
    point = JSON.parse(raw) as ResumePoint;
  } catch {
    return null;
  }
  if (
    !Array.isArray(point.trackIds) ||
    point.trackIds.length === 0 ||
    typeof point.index !== 'number' ||
    typeof point.updatedAt !== 'number'
  ) {
    return null;
  }
  return point;
}

/** Efface le point de reprise (déconnexion, changement de compte). */
export function clearResumePoint(): void {
  lastWriteAt = 0;
  db.deleteSetting(RESUME_KEY);
  db.deleteSetting(DISMISSED_KEY);
}

/** Mémorise que l'utilisateur a écarté cette proposition de reprise. */
export function dismissResumePoint(point: ResumePoint): void {
  db.setSetting(DISMISSED_KEY, String(point.updatedAt));
}

/** Vrai si cette proposition précise a déjà été écartée. */
export function isResumeDismissed(point: ResumePoint): boolean {
  return db.getSetting(DISMISSED_KEY) === String(point.updatedAt);
}
