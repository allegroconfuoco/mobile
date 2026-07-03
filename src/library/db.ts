/**
 * Persistance locale de la bibliothèque (SQLite) — issue #10.
 *
 * Objectif : éviter de re-scanner tout le media store à chaque lancement. On stocke les pistes
 * détectées (avec leur dossier résolu une fois au scan) et les préférences d'inclusion. Au
 * démarrage on relit la base instantanément ; le scan ne fait plus qu'un *diff* incrémental.
 *
 * Tout est gardé par `Platform.OS !== 'web'` : le web (simple cible d'export CI, cf. PROJET.md)
 * n'ouvre jamais la base et reçoit des résultats vides — comme le reste du code natif.
 *
 * API synchrone d'expo-sqlite : ouverture + lectures/écritures sur le thread JS. Les volumes
 * (quelques milliers de lignes, écrites par lots dans une transaction) le supportent sans souci.
 */
import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

/** Une piste persistée. Les colonnes snake_case sont ré-aliasées en camelCase à la lecture. */
export type TrackRow = {
  id: string;
  filename: string;
  title: string;
  /** Dossier parent (chemin absolu) résolu au scan, ou `''` si l'URI n'a pu être résolue. */
  folder: string;
  /** URI `file://` résolue au scan, conservée comme indice (la lecture la re-résout au besoin). */
  uri: string | null;
  durationMs: number | null;
  modificationTime: number | null;
  creationTime: number | null;
  /** Artiste (tag ID3), lu au scan. `null` si absent/illisible. */
  artist: string | null;
  /** Album (tag ID3), lu au scan. */
  album: string | null;
  /** Artiste de l'album (tag ID3 TPE2) : regroupe les compilations. */
  albumArtist: string | null;
  /** Numéro de piste (tag ID3), pour ordonner au sein d'un disque. */
  trackNo: number | null;
  /** Numéro de disque (tag ID3 TPOS), pour ordonner un album multi-disques. */
  discNo: number | null;
  /** URI `file://` d'une pochette extraite en cache au scan, ou `null`. */
  artworkUri: string | null;
};

/** Décision d'inclusion d'un dossier dans la bibliothèque. */
export type FolderPref = { folder: string; included: boolean };

const isSupported = Platform.OS !== 'web';

const SCHEMA_VERSION = 3;

let dbInstance: SQLite.SQLiteDatabase | null = null;

/** Ouvre (paresseusement) et migre la base. Renvoie `null` sur web. */
function db(): SQLite.SQLiteDatabase | null {
  if (!isSupported) {
    return null;
  }
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync('fuoco.db');
    migrate(dbInstance);
  }
  return dbInstance;
}

/**
 * Migre la base par paliers de version (`PRAGMA user_version`). Chaque palier est idempotent
 * et ne s'applique qu'une fois ; un nouvel appareil traverse tous les paliers d'affilée.
 */
function migrate(database: SQLite.SQLiteDatabase): void {
  const row = database.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) {
    return;
  }

  // v1 : schéma initial (pistes + préférences de dossiers + exclusions).
  if (current < 1) {
    database.execSync(`
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY NOT NULL,
        filename TEXT NOT NULL,
        title TEXT NOT NULL,
        folder TEXT NOT NULL,
        uri TEXT,
        duration_ms INTEGER,
        modification_time INTEGER,
        creation_time INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks (folder);
      CREATE TABLE IF NOT EXISTS folder_prefs (
        folder TEXT PRIMARY KEY NOT NULL,
        included INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS excluded_tracks (
        track_id TEXT PRIMARY KEY NOT NULL
      );
    `);
  }

  // v2 : métadonnées de tags (artiste/album/album artist/n° piste/pochette) lues au scan.
  // On vide `tracks` pour forcer un re-scan complet : les lignes existantes (issue #10) n'ont
  // pas ces colonnes et le diff incrémental ne les relirait jamais autrement. Les préférences
  // de dossiers et les exclusions, elles, sont conservées.
  if (current < 2) {
    database.execSync(`
      ALTER TABLE tracks ADD COLUMN artist TEXT;
      ALTER TABLE tracks ADD COLUMN album TEXT;
      ALTER TABLE tracks ADD COLUMN album_artist TEXT;
      ALTER TABLE tracks ADD COLUMN track_no INTEGER;
      ALTER TABLE tracks ADD COLUMN artwork_uri TEXT;
      DELETE FROM tracks;
    `);
  }

  // v3 : numéro de disque (TPOS) pour l'ordre des albums multi-disques. Même logique qu'en v2,
  // on vide `tracks` pour forcer la relecture du tag (le diff incrémental ne rattraperait pas
  // les lignes déjà connues) ; préférences de dossiers et exclusions conservées.
  if (current < 3) {
    database.execSync(`
      ALTER TABLE tracks ADD COLUMN disc_no INTEGER;
      DELETE FROM tracks;
    `);
  }

  database.execSync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/** Toutes les pistes persistées, triées par date de modification décroissante (ordre d'affichage). */
export function loadTracks(): TrackRow[] {
  const database = db();
  if (!database) {
    return [];
  }
  return database.getAllSync<TrackRow>(
    `SELECT id, filename, title, folder, uri,
            duration_ms AS durationMs,
            modification_time AS modificationTime,
            creation_time AS creationTime,
            artist, album,
            album_artist AS albumArtist,
            track_no AS trackNo,
            disc_no AS discNo,
            artwork_uri AS artworkUri
       FROM tracks
       ORDER BY modification_time DESC`
  );
}

/** Préférences d'inclusion par dossier. */
export function loadFolderPrefs(): FolderPref[] {
  const database = db();
  if (!database) {
    return [];
  }
  return database
    .getAllSync<{ folder: string; included: number }>('SELECT folder, included FROM folder_prefs')
    .map((r) => ({ folder: r.folder, included: r.included !== 0 }));
}

/** Ids des pistes exclues individuellement. */
export function loadExcludedTracks(): string[] {
  const database = db();
  if (!database) {
    return [];
  }
  return database
    .getAllSync<{ track_id: string }>('SELECT track_id FROM excluded_tracks')
    .map((r) => r.track_id);
}

/** Insère ou met à jour un lot de pistes (transaction unique, requête préparée). */
export function upsertTracks(rows: TrackRow[]): void {
  const database = db();
  if (!database || rows.length === 0) {
    return;
  }
  const stmt = database.prepareSync(
    `INSERT OR REPLACE INTO tracks
       (id, filename, title, folder, uri, duration_ms, modification_time, creation_time,
        artist, album, album_artist, track_no, disc_no, artwork_uri)
     VALUES ($id, $filename, $title, $folder, $uri, $durationMs, $modificationTime, $creationTime,
        $artist, $album, $albumArtist, $trackNo, $discNo, $artworkUri)`
  );
  try {
    database.withTransactionSync(() => {
      for (const r of rows) {
        stmt.executeSync({
          $id: r.id,
          $filename: r.filename,
          $title: r.title,
          $folder: r.folder,
          $uri: r.uri,
          $durationMs: r.durationMs,
          $modificationTime: r.modificationTime,
          $creationTime: r.creationTime,
          $artist: r.artist,
          $album: r.album,
          $albumArtist: r.albumArtist,
          $trackNo: r.trackNo,
          $discNo: r.discNo,
          $artworkUri: r.artworkUri,
        });
      }
    });
  } finally {
    stmt.finalizeSync();
  }
}

/** Supprime les pistes disparues du media store. */
export function deleteTracks(ids: string[]): void {
  const database = db();
  if (!database || ids.length === 0) {
    return;
  }
  const placeholders = ids.map(() => '?').join(',');
  database.runSync(`DELETE FROM tracks WHERE id IN (${placeholders})`, ids);
}

/** Crée la préférence d'un dossier avec sa valeur par défaut, sans écraser un choix existant. */
export function ensureFolderPref(folder: string, defaultIncluded: boolean): void {
  const database = db();
  if (!database) {
    return;
  }
  database.runSync('INSERT OR IGNORE INTO folder_prefs (folder, included) VALUES (?, ?)', [
    folder,
    defaultIncluded ? 1 : 0,
  ]);
}

/** Définit (ou met à jour) l'inclusion d'un dossier — choix explicite de l'utilisateur. */
export function setFolderIncluded(folder: string, included: boolean): void {
  const database = db();
  if (!database) {
    return;
  }
  database.runSync('INSERT OR REPLACE INTO folder_prefs (folder, included) VALUES (?, ?)', [
    folder,
    included ? 1 : 0,
  ]);
}

/** Exclut ou réinclut une piste individuelle. */
export function setTrackExcluded(id: string, excluded: boolean): void {
  const database = db();
  if (!database) {
    return;
  }
  if (excluded) {
    database.runSync('INSERT OR IGNORE INTO excluded_tracks (track_id) VALUES (?)', [id]);
  } else {
    database.runSync('DELETE FROM excluded_tracks WHERE track_id = ?', [id]);
  }
}
