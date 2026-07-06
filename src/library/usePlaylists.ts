import { useCallback, useState } from 'react';

import { uuidv7 } from '@/sync/uuid';
import * as db from './db';

/**
 * Gestion des playlists locales (issue #14), avec le modèle de synchro (issue #17).
 *
 * L'état vit dans SQLite (lectures synchrones) ; on garde ici la liste des playlists (avec leurs
 * compteurs) et un `revision` qui s'incrémente à chaque mutation. Les écrans qui lisent le contenu
 * d'une playlist (`getEntries`) mémoïsent sur `revision` pour se resynchroniser sans dupliquer cet
 * état — la base reste l'unique source de vérité.
 *
 * Depuis la synchro : les ids de playlist et de ligne sont des **UUIDv7 détenus par le client**
 * (identité stable entre appareils), les pistes sont référencées par un **id partagé** (cf.
 * `track_registry` dans `db.ts`) et non plus par l'id media-store, et les suppressions sont des
 * tombstones. Le moteur de synchro (`SyncProvider`) applique le delta serveur puis appelle
 * `refresh()` pour rafraîchir l'UI.
 */

export type UsePlaylists = {
  /** Playlists vivantes, la plus récemment modifiée en tête. */
  playlists: db.PlaylistRow[];
  /** Change à chaque mutation : à mettre en dépendance d'un `useMemo(() => getEntries(id))`. */
  revision: number;
  /** Relit la liste depuis la base et signale le changement (après une mutation ou un pull sync). */
  refresh: () => void;
  /** Crée une playlist et renvoie son id. */
  createPlaylist: (name: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  /** Ajoute des pistes (ids media-store) à la fin d'une playlist. */
  addTracksToPlaylist: (id: string, localTrackIds: string[]) => void;
  /** Retire une piste d'une playlist par son id *partagé*. */
  removeTrackFromPlaylist: (id: string, sharedTrackId: string) => void;
  /** Réordonne la playlist depuis l'ordre complet d'ids *partagés* fourni. */
  reorderPlaylist: (id: string, orderedSharedIds: string[]) => void;
  /** Entrées d'une playlist, dans l'ordre (lecture directe en base). */
  getEntries: (id: string) => db.PlaylistEntry[];
};

export function usePlaylists(): UsePlaylists {
  const [playlists, setPlaylists] = useState<db.PlaylistRow[]>(() => db.loadPlaylists());
  const [revision, setRevision] = useState(0);

  // Rejoue la liste depuis la base et signale le changement aux consommateurs de `getEntries`.
  const refresh = useCallback(() => {
    setPlaylists(db.loadPlaylists());
    setRevision((r) => r + 1);
  }, []);

  const createPlaylist = useCallback(
    (name: string) => {
      const id = uuidv7();
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
      db.deletePlaylist(id, Date.now());
      refresh();
    },
    [refresh]
  );

  const addTracksToPlaylist = useCallback(
    (id: string, localTrackIds: string[]) => {
      db.addTracksToPlaylist(id, localTrackIds, Date.now());
      refresh();
    },
    [refresh]
  );

  const removeTrackFromPlaylist = useCallback(
    (id: string, sharedTrackId: string) => {
      db.removeTrackFromPlaylist(id, sharedTrackId, Date.now());
      refresh();
    },
    [refresh]
  );

  const reorderPlaylist = useCallback(
    (id: string, orderedSharedIds: string[]) => {
      db.setPlaylistTrackOrder(id, orderedSharedIds, Date.now());
      refresh();
    },
    [refresh]
  );

  const getEntries = useCallback((id: string) => db.loadPlaylistEntries(id), []);

  return {
    playlists,
    revision,
    refresh,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTracksToPlaylist,
    removeTrackFromPlaylist,
    reorderPlaylist,
    getEntries,
  };
}
