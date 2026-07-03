import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import {
  type AssetMetadata,
  Asset,
  AssetField,
  MediaType,
  Query,
  usePermissions,
} from 'expo-media-library';

import * as db from './db';
import { displayFolder, folderOf, isAutoExcluded } from './folders';
import { extractTrackTags, type TrackTags } from './trackTags';
import {
  buildAlbums,
  buildArtists,
  sortTracks,
  type AlbumGroup,
  type ArtistGroup,
  type TrackSort,
} from './grouping';

/**
 * Un morceau audio détecté sur l'appareil.
 *
 * Le scan ne lit que les métadonnées légères du media store (`Query.exeForMetadata`), plus le
 * dossier résolu une fois via `Asset.getUri()` (le media store « Next » n'expose pas le chemin).
 * L'URI réelle nécessaire à la lecture reste re-résolue à la demande.
 */
export type LocalTrack = {
  /** ID du media store (contentUri Android) — sert à ré-instancier un `Asset`. */
  id: string;
  /** Titre affiché : tag ID3 s'il existe, sinon nom de fichier sans extension. */
  title: string;
  /** Nom de fichier complet, extension comprise. */
  filename: string;
  /** Durée en millisecondes, ou `null` si le media store ne la connaît pas. */
  durationMs: number | null;
  /** Dossier parent (chemin absolu), ou `''` si non résolu. */
  folder: string;
  /** Artiste (tag ID3), lu au scan, ou `null`. */
  artist: string | null;
  /** Album (tag ID3), ou `null`. */
  album: string | null;
  /** Artiste de l'album (tag ID3 TPE2), ou `null`. */
  albumArtist: string | null;
  /** Numéro de piste (tag ID3), ou `null`. */
  trackNo: number | null;
  /** Numéro de disque (tag ID3 TPOS), ou `null`. */
  discNo: number | null;
  /** URI `file://` d'une pochette extraite en cache au scan, ou `null`. */
  artworkUri: string | null;
};

/** Un dossier de la bibliothèque, pour l'écran de réglages. */
export type LibraryFolder = {
  /** Chemin absolu (clé de préférence). */
  folder: string;
  /** Nom lisible (préfixe stockage retiré). */
  name: string;
  /** Nombre de titres dans ce dossier. */
  count: number;
  /** Le dossier est-il scanné (inclus) ? */
  included: boolean;
};

/** État de haut niveau de la bibliothèque, consommé directement par l'UI. */
export type LibraryStatus =
  | 'loading' // permission en cours de résolution
  | 'unsupported' // plateforme sans media store (web)
  | 'undetermined' // permission demandable (jamais demandée, ou refus « ré-essayable »)
  | 'denied' // permission refusée définitivement → réglages système
  | 'scanning' // premier scan (aucun cache) en cours
  | 'ready'; // cache disponible et/ou scan terminé

// Le media store n'existe pas sur le web : on court-circuite pour ne pas planter l'export.
const isSupported = Platform.OS !== 'web';

// Nombre de résolutions d'URI en parallèle au scan (les nouveaux fichiers uniquement).
const RESOLVE_CONCURRENCY = 8;

const NO_TAGS: TrackTags = {
  title: null,
  artist: null,
  album: null,
  albumArtist: null,
  trackNo: null,
  discNo: null,
  artworkUri: null,
};

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function toRow(
  meta: AssetMetadata,
  folder: string,
  uri: string | null,
  tags: TrackTags
): db.TrackRow {
  const filename = meta.filename ?? 'Fichier inconnu';
  const fallbackTitle = meta.filename ? stripExtension(meta.filename) : 'Titre inconnu';
  return {
    id: meta.id,
    filename,
    // Le tag ID3 prime sur le nom de fichier ; repli propre s'il manque.
    title: tags.title ?? fallbackTitle,
    folder,
    uri,
    durationMs: meta.duration,
    modificationTime: meta.modificationTime,
    creationTime: meta.creationTime,
    artist: tags.artist,
    album: tags.album,
    albumArtist: tags.albumArtist,
    trackNo: tags.trackNo,
    discNo: tags.discNo,
    artworkUri: tags.artworkUri,
  };
}

function rowToTrack(r: db.TrackRow): LocalTrack {
  return {
    id: r.id,
    title: r.title,
    filename: r.filename,
    durationMs: r.durationMs,
    folder: r.folder,
    artist: r.artist,
    album: r.album,
    albumArtist: r.albumArtist,
    trackNo: r.trackNo,
    discNo: r.discNo,
    artworkUri: r.artworkUri,
  };
}

/**
 * Résout le dossier et les tags ID3 d'un lot de nouvelles pistes, en parallèle borné.
 *
 * L'URI (via `getUri`) sert à la fois à déduire le dossier et à lire les tags : une seule
 * résolution par piste. L'extraction des tags est synchrone (lecture partielle du fichier) et
 * peuple aussi le cache mémoire de `trackTags`, donc l'affichage n'a plus besoin de relire.
 */
async function resolveRows(metas: AssetMetadata[]): Promise<db.TrackRow[]> {
  const rows = new Array<db.TrackRow>(metas.length);
  let next = 0;
  const worker = async () => {
    while (next < metas.length) {
      const idx = next++;
      const meta = metas[idx];
      let uri: string | null = null;
      let folder = '';
      let tags = NO_TAGS;
      try {
        uri = await new Asset(meta.id).getUri();
        folder = folderOf(uri);
        tags = extractTrackTags(meta.id, uri);
      } catch (e) {
        console.warn('[useAudioLibrary] URI/tags introuvables', e);
      }
      rows[idx] = toRow(meta, folder, uri, tags);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(RESOLVE_CONCURRENCY, metas.length) }, () => worker())
  );
  return rows;
}

function prefsToMap(prefs: db.FolderPref[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const p of prefs) {
    map[p.folder] = p.included;
  }
  return map;
}

type UseAudioLibrary = {
  status: LibraryStatus;
  /** Pistes visibles (dossier inclus ET non exclues), triées selon `trackSort`. */
  tracks: LocalTrack[];
  /** Critère de tri courant de la liste des morceaux. */
  trackSort: TrackSort;
  /** Change le tri de la liste des morceaux (titre / artiste). */
  setTrackSort: (sort: TrackSort) => void;
  /** Artistes de la bibliothèque, agrégés et triés (onglet Artistes). */
  artists: ArtistGroup[];
  /** Albums de la bibliothèque, agrégés et triés (onglet Albums). */
  albums: AlbumGroup[];
  /** Un scan de fond tourne alors qu'un cache est déjà affiché. */
  refreshing: boolean;
  error: string | null;
  /** Dossiers détectés, avec compteur et état d'inclusion (écran réglages). */
  folders: LibraryFolder[];
  /** Pistes exclues individuellement (écran réglages). */
  excludedTracks: LocalTrack[];
  /** Demande la permission `READ_MEDIA_AUDIO` (Android 13+). */
  requestPermission: () => void;
  /** Relance un scan incrémental. */
  rescan: () => void;
  /** Inclut/exclut un dossier du scan. */
  setFolderIncluded: (folder: string, included: boolean) => void;
  /** Exclut/réinclut une piste individuelle. */
  setTrackExcluded: (id: string, excluded: boolean) => void;
};

/**
 * Découvre et persiste les fichiers audio de l'appareil.
 *
 * Au montage, relit la base SQLite (affichage instantané du cache). Une fois la permission
 * accordée, lance un scan *incrémental* : seuls les nouveaux fichiers sont résolus (`getUri` →
 * dossier), les disparus sont retirés. La liste exposée est déjà filtrée par les préférences
 * d'inclusion (dossiers + pistes).
 */
export function useAudioLibrary(): UseAudioLibrary {
  const [permission, requestPermission] = usePermissions({
    granularPermissions: ['audio'],
  });

  // État initialisé synchroniquement depuis SQLite : le cache s'affiche sans flash au démarrage.
  const [allTracks, setAllTracks] = useState<db.TrackRow[]>(() => db.loadTracks());
  const [folderPrefs, setFolderPrefs] = useState<Record<string, boolean>>(() =>
    prefsToMap(db.loadFolderPrefs())
  );
  const [excludedIds, setExcludedIds] = useState<Set<string>>(
    () => new Set(db.loadExcludedTracks())
  );
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackSort, setTrackSort] = useState<TrackSort>('title');

  const scan = useCallback(async () => {
    if (!isSupported) {
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const results = await new Query()
        .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
        .orderBy({ key: AssetField.MODIFICATION_TIME, ascending: false })
        .exeForMetadata();

      // Diff par id contre la base : on ne re-résout (getUri) que les nouveaux fichiers.
      const known = new Set(db.loadTracks().map((t) => t.id));
      const seen = new Set<string>();
      const fresh: AssetMetadata[] = [];
      for (const meta of results) {
        seen.add(meta.id);
        if (!known.has(meta.id)) {
          fresh.push(meta);
        }
      }

      const newRows = await resolveRows(fresh);
      for (const row of newRows) {
        db.ensureFolderPref(row.folder, !isAutoExcluded(row.folder));
      }
      db.upsertTracks(newRows);

      const removed = [...known].filter((id) => !seen.has(id));
      db.deleteTracks(removed);

      // Re-synchronise l'état en mémoire depuis la base (source de vérité).
      setAllTracks(db.loadTracks());
      setFolderPrefs(prefsToMap(db.loadFolderPrefs()));
      setExcludedIds(new Set(db.loadExcludedTracks()));
    } catch (e) {
      console.warn('[useAudioLibrary] scan failed', e);
      setError('Le scan de la bibliothèque a échoué.');
    } finally {
      setScanning(false);
    }
  }, []);

  // Scan automatique dès que l'accès est accordé (au montage ou après acceptation).
  // Synchronisation légitime avec une source externe (le media store) ; le cache reste affiché.
  useEffect(() => {
    if (permission?.granted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void scan();
    }
  }, [permission?.granted, scan]);

  const isIncluded = useCallback((folder: string) => folderPrefs[folder] ?? true, [folderPrefs]);

  // Pistes visibles, non triées : base commune du tri des morceaux et des regroupements.
  const visibleTracks = useMemo(
    () => allTracks.filter((t) => isIncluded(t.folder) && !excludedIds.has(t.id)).map(rowToTrack),
    [allTracks, isIncluded, excludedIds]
  );

  const tracks = useMemo(() => sortTracks(visibleTracks, trackSort), [visibleTracks, trackSort]);

  const artists = useMemo(() => buildArtists(visibleTracks), [visibleTracks]);
  const albums = useMemo(() => buildAlbums(visibleTracks), [visibleTracks]);

  const folders = useMemo<LibraryFolder[]>(() => {
    const counts = new Map<string, number>();
    for (const t of allTracks) {
      counts.set(t.folder, (counts.get(t.folder) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([folder, count]) => ({
        folder,
        name: displayFolder(folder),
        count,
        included: isIncluded(folder),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allTracks, isIncluded]);

  const excludedTracks = useMemo(
    () => allTracks.filter((t) => excludedIds.has(t.id)).map(rowToTrack),
    [allTracks, excludedIds]
  );

  const setFolderIncluded = useCallback((folder: string, included: boolean) => {
    db.setFolderIncluded(folder, included);
    setFolderPrefs((prev) => ({ ...prev, [folder]: included }));
  }, []);

  const setTrackExcluded = useCallback((id: string, excluded: boolean) => {
    db.setTrackExcluded(id, excluded);
    setExcludedIds((prev) => {
      const nextSet = new Set(prev);
      if (excluded) {
        nextSet.add(id);
      } else {
        nextSet.delete(id);
      }
      return nextSet;
    });
  }, []);

  const hasCache = allTracks.length > 0;

  let status: LibraryStatus;
  if (!isSupported) {
    status = 'unsupported';
  } else if (!permission) {
    status = 'loading';
  } else if (permission.granted) {
    status = scanning && !hasCache ? 'scanning' : 'ready';
  } else if (permission.canAskAgain) {
    status = 'undetermined';
  } else {
    status = 'denied';
  }

  return {
    status,
    tracks,
    trackSort,
    setTrackSort,
    artists,
    albums,
    refreshing: scanning && hasCache,
    error,
    folders,
    excludedTracks,
    requestPermission: () => void requestPermission(),
    rescan: () => void scan(),
    setFolderIncluded,
    setTrackExcluded,
  };
}
