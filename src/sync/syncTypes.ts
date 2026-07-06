/**
 * Types du protocole de synchro playlists (issue #17), miroir exact du contrat backend
 * (`backend/src/Service/PlaylistSyncService.php`).
 *
 * ⚠️ Ce format est **propre à l'endpoint `/api/sync/playlists`** : ce n'est PAS la forme JSON-LD
 * d'API Platform (playlist:read). Les champs sont plats (`playlistId`/`trackId`/`deleted`), pas
 * imbriqués. Ne pas aligner sur les entités REST.
 */

// --- Poussé par le client (seulement les lignes modifiées depuis le dernier sync) ---------------

export type SyncTrackPush = {
  id: string;
  title?: string;
  artist?: string;
  mbid?: string;
};

export type SyncPlaylistPush = {
  id: string;
  name?: string;
  description?: string | null;
  deleted?: boolean;
};

export type SyncPlaylistTrackPush = {
  id: string;
  playlistId: string;
  trackId: string;
  position?: number;
  deleted?: boolean;
};

export type SyncRequest = {
  /** Curseur delta (`serverTime` du sync précédent), ou `null` au premier sync. */
  since: string | null;
  tracks: SyncTrackPush[];
  playlists: SyncPlaylistPush[];
  playlistTracks: SyncPlaylistTrackPush[];
};

// --- Renvoyé par le serveur (delta depuis `since`, positions renumérotées, tombstones inclus) ----

export type SyncTrackPull = {
  id: string;
  title: string | null;
  artist: string | null;
  mbid: string | null;
};

export type SyncPlaylistPull = {
  id: string;
  name: string | null;
  description: string | null;
  deleted: boolean;
  updatedAt: string | null;
};

export type SyncPlaylistTrackPull = {
  id: string;
  playlistId: string;
  trackId: string;
  position: number;
  deleted: boolean;
  updatedAt: string | null;
};

export type SyncResponse = {
  /** Horloge serveur : curseur à renvoyer en `since` au prochain sync (comparaison `>=`). */
  serverTime: string;
  playlists: SyncPlaylistPull[];
  tracks: SyncTrackPull[];
  playlistTracks: SyncPlaylistTrackPull[];
};
