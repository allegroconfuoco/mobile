import { useCallback, useState } from 'react';

import * as db from './db';

/**
 * Gestion des playlists locales (issue #14).
 *
 * L'état vit dans SQLite (lectures synchrones) ; on garde ici la liste des playlists (avec leurs
 * compteurs) et un `revision` qui s'incrémente à chaque mutation. Les écrans qui lisent l'ordre
 * des pistes d'une playlist (`getTrackIds`) mémoïsent sur `revision` pour se resynchroniser sans
 * dupliquer cet état — la base reste l'unique source de vérité.
 *
 * Les ids de pistes stockés sont ceux du media store (= `LocalTrack.id`) : c'est purement local
 * pour la Phase 1. La synchro backend (references artiste/titre/MBID, cf. PROJET.md) viendra
 * remplacer/compléter cette clé ; le modèle de tables ne change pas d'ici là.
 */

/** UUIDv4 pseudo-aléatoire, suffisant pour un id local (pas d'usage cryptographique). */
function randomId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type UsePlaylists = {
  /** Playlists, la plus récemment modifiée en tête. */
  playlists: db.PlaylistRow[];
  /** Change à chaque mutation : à mettre en dépendance d'un `useMemo(() => getTrackIds(id))`. */
  revision: number;
  /** Crée une playlist et renvoie son id. */
  createPlaylist: (name: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addTracksToPlaylist: (id: string, trackIds: string[]) => void;
  removeTrackFromPlaylist: (id: string, trackId: string) => void;
  /** Réordonne la playlist depuis l'ordre complet d'ids fourni. */
  reorderPlaylist: (id: string, orderedIds: string[]) => void;
  /** Ids des pistes d'une playlist, dans l'ordre (lecture directe en base). */
  getTrackIds: (id: string) => string[];
};

export function usePlaylists(): UsePlaylists {
  const [playlists, setPlaylists] = useState<db.PlaylistRow[]>(() => db.loadPlaylists());
  const [revision, setRevision] = useState(0);

  // Rejoue la liste depuis la base et signale le changement aux consommateurs de `getTrackIds`.
  const refresh = useCallback(() => {
    setPlaylists(db.loadPlaylists());
    setRevision((r) => r + 1);
  }, []);

  const createPlaylist = useCallback(
    (name: string) => {
      const id = randomId();
      db.createPlaylist(id, name.trim(), Date.now());
      refresh();
      return id;
    },
    [refresh]
  );

  const renamePlaylist = useCallback(
    (id: string, name: string) => {
      db.renamePlaylist(id, name.trim(), Date.now());
      refresh();
    },
    [refresh]
  );

  const deletePlaylist = useCallback(
    (id: string) => {
      db.deletePlaylist(id);
      refresh();
    },
    [refresh]
  );

  const addTracksToPlaylist = useCallback(
    (id: string, trackIds: string[]) => {
      db.addTracksToPlaylist(id, trackIds, Date.now());
      refresh();
    },
    [refresh]
  );

  const removeTrackFromPlaylist = useCallback(
    (id: string, trackId: string) => {
      db.removeTrackFromPlaylist(id, trackId, Date.now());
      refresh();
    },
    [refresh]
  );

  const reorderPlaylist = useCallback(
    (id: string, orderedIds: string[]) => {
      db.setPlaylistTrackOrder(id, orderedIds, Date.now());
      refresh();
    },
    [refresh]
  );

  const getTrackIds = useCallback((id: string) => db.loadPlaylistTrackIds(id), []);

  return {
    playlists,
    revision,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTracksToPlaylist,
    removeTrackFromPlaylist,
    reorderPlaylist,
    getTrackIds,
  };
}
