import * as db from '@/library/db';

/**
 * D'où vient la file en cours : la playlist, l'album ou l'artiste depuis lequel la lecture a été
 * lancée. Sert à l'écran Lecture, qui propose d'y retourner d'un tap sur le titre.
 *
 * Distinct du `PlayContext` de l'historique d'écoute : celui-ci est une étiquette statistique
 * (« lancé depuis une playlist »), alors qu'ici il faut de quoi **naviguer** (le nom de l'artiste,
 * la clé de l'album). Persisté dans `app_settings` pour survivre à un redémarrage, comme le point
 * de reprise dont il est le compagnon.
 */
export type QueueSource =
  | { kind: 'playlist'; id: string; name: string }
  | { kind: 'album'; artist: string; title: string }
  | { kind: 'artist'; name: string }
  | { kind: 'favorites' }
  | { kind: 'recent' };

const SOURCE_KEY = 'playback.source';

let current: QueueSource | null | undefined;

/** Source de la file en cours, ou `null` (bibliothèque entière, recherche, historique…). */
export function getQueueSource(): QueueSource | null {
  if (current === undefined) {
    const raw = db.getSetting(SOURCE_KEY);
    try {
      current = raw ? (JSON.parse(raw) as QueueSource) : null;
    } catch {
      current = null;
    }
  }
  return current;
}

/** Posée par `playQueue` à chaque lancement de file. */
export function setQueueSource(source: QueueSource | null): void {
  current = source;
  if (source) {
    db.setSetting(SOURCE_KEY, JSON.stringify(source));
  } else {
    db.deleteSetting(SOURCE_KEY);
  }
}
