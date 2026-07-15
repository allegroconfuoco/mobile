import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
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
import { clearCoverCache, extractTrackTags, type TrackTags } from './trackTags';
import {
  buildAlbums,
  sortTracks,
  type AlbumGroup,
  type ArtistGroup,
  type TrackSort,
} from './grouping';
import { buildMergedArtists } from './artists';

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
  /** Date d'ajout au media store (ms), ou `null` — sert au tri « Ajouts récents ». */
  creationTime: number | null;
  /** MBID résolu par l'enrichissement MusicBrainz (issue #19), ou `null`. */
  mbid: string | null;
  /** URL de pochette distante (Cover Art Archive) issue de l'enrichissement, repli d'affichage. */
  coverArtUrl: string | null;
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

/**
 * Un fichier déjà connu doit être re-résolu (getUri + tags) si son **nom** ou sa **date de modif**
 * diffère du cache : signal d'un renommage « de propreté » ou d'une réécriture (ré-encodage/ré-tag).
 * Sans ça, le diff par id sautait ces fichiers et gardait un nom/tags périmés. L'id media-store
 * étant conservé au renommage, la ligne `tracks` est réécrite mais l'enrichissement MusicBrainz
 * (table séparée `track_enrichment`, clé = id) reste intact. Le nom se compare avec le même repli
 * que `toRow` pour ne pas déclencher un faux positif sur un media store sans nom de fichier.
 */
function fileChanged(prev: db.TrackRow, meta: AssetMetadata): boolean {
  const nextFilename = meta.filename ?? 'Fichier inconnu';
  return prev.filename !== nextFilename || prev.modificationTime !== meta.modificationTime;
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
    // Enrichissement (issue #19) : absent au scan, peuplé par le JOIN de `loadTracks`.
    mbid: null,
    coverArtUrl: null,
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
    creationTime: r.creationTime,
    mbid: r.mbid,
    coverArtUrl: r.coverArtUrl,
  };
}

/**
 * Passe 1 du scan : résout l'URI et le dossier d'un lot de nouvelles pistes, en parallèle borné.
 *
 * Les tags ne sont **pas** lus ici (lot 5 de l'audit) : leur extraction est synchrone (parse ID3
 * + écriture de la pochette sur disque) et bloquait le thread JS pendant tout un premier scan.
 * La passe 1 insère les lignes avec le repli nom-de-fichier (`toRow` s'en charge) pour afficher
 * la bibliothèque vite ; la passe 2 (`extractTagsInBatches`) enrichit ensuite en fond.
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
      try {
        uri = await new Asset(meta.id).getUri();
        folder = folderOf(uri);
      } catch (e) {
        console.warn('[useAudioLibrary] URI introuvable', e);
      }
      rows[idx] = toRow(meta, folder, uri, NO_TAGS);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(RESOLVE_CONCURRENCY, metas.length) }, () => worker())
  );
  return rows;
}

/** Taille de lot de la passe 2 : assez petit pour garder le thread JS réactif entre deux yields. */
const TAG_BATCH = 15;

/**
 * Passe 2 du scan : extraction des tags ID3 + pochettes, par lots avec **yield JS** entre chaque
 * lot. L'extraction reste synchrone piste par piste (parse + JPEG), mais découpée elle laisse
 * respirer l'UI. Peuple aussi le cache mémoire de `trackTags` (l'affichage n'a plus à relire).
 * `isStale` coupe la passe si un nouveau scan a démarré entre-temps.
 */
async function extractTagsInBatches(
  rows: db.TrackRow[],
  isStale: () => boolean,
  onBatch: () => void
): Promise<void> {
  for (let i = 0; i < rows.length; i += TAG_BATCH) {
    if (isStale()) {
      return;
    }
    for (const row of rows.slice(i, i + TAG_BATCH)) {
      if (!row.uri) {
        continue;
      }
      try {
        db.updateScannedTags(row.id, extractTrackTags(row.id, row.uri));
      } catch (e) {
        console.warn('[useAudioLibrary] extraction des tags échouée', e);
      }
    }
    onBatch();
    await new Promise<void>((resolve) => setTimeout(resolve));
  }
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
  /**
   * Index de *toutes* les pistes scannées (dossiers exclus compris) par id.
   * Sert à résoudre les références d'une playlist en `LocalTrack` : une piste ajoutée à une
   * playlist reste jouable même si son dossier a été décoché ensuite dans les réglages.
   */
  tracksById: Map<string, LocalTrack>;
  /** Un scan de fond tourne alors qu'un cache est déjà affiché. */
  refreshing: boolean;
  /**
   * La passe de fond d'extraction des tags (passe 2 du scan) est en cours : la bibliothèque est
   * affichable mais des titres/pochettes s'affinent encore. L'enrichissement MusicBrainz doit
   * attendre sa fin (il a besoin des vrais tags, pas des noms de fichiers).
   */
  tagging: boolean;
  error: string | null;
  /** Dossiers détectés, avec compteur et état d'inclusion (écran réglages). */
  folders: LibraryFolder[];
  /** Pistes exclues individuellement (écran réglages). */
  excludedTracks: LocalTrack[];
  /** Demande la permission `READ_MEDIA_AUDIO` (Android 13+). */
  requestPermission: () => void;
  /** Relance un scan incrémental. */
  rescan: () => void;
  /**
   * Relit les pistes depuis SQLite sans re-scanner le media store. Sert à refléter une écriture
   * hors scan (enrichissement MusicBrainz, issue #19) dans l'état affiché.
   */
  reloadTracks: () => void;
  /**
   * Vide le cache (pochettes disque + pistes scannées) et relance un scan complet qui le
   * reconstruit. Renvoie les octets de pochettes libérés. Ne touche à aucune donnée utilisateur
   * (playlists, favoris, corrections MusicBrainz : tables séparées, conservées).
   */
  clearCache: () => Promise<number>;
  /** Inclut/exclut un dossier du scan. */
  setFolderIncluded: (folder: string, included: boolean) => void;
  /** Exclut/réinclut une piste individuelle. */
  setTrackExcluded: (id: string, excluded: boolean) => void;
  /** Exclut/réinclut un lot de pistes (action groupée du mode sélection). */
  setTracksExcluded: (ids: string[], excluded: boolean) => void;
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
  // Passe 2 (tags) en cours : la biblio est affichable mais ses métadonnées s'affinent encore.
  const [tagging, setTagging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tri persisté (lot 8) : survivait auparavant à la session seulement.
  const [trackSort, setTrackSortState] = useState<TrackSort>(() => {
    const saved = db.getSetting('library.sort');
    return saved === 'artist' || saved === 'recent' ? saved : 'title';
  });
  const setTrackSort = useCallback((sort: TrackSort) => {
    setTrackSortState(sort);
    db.setSetting('library.sort', sort);
  }, []);

  // Numéro de scan : un nouveau scan rend périmée la passe de tags du précédent (elle s'arrête).
  const scanSeq = useRef(0);

  const scan = useCallback(async () => {
    if (!isSupported) {
      return;
    }
    const seq = ++scanSeq.current;
    setScanning(true);
    setError(null);
    let toTag: db.TrackRow[] = [];
    try {
      const results = await new Query()
        .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
        .orderBy({ key: AssetField.MODIFICATION_TIME, ascending: false })
        .exeForMetadata();

      // Diff par id contre la base : on re-résout (getUri + tags) les fichiers *nouveaux*, mais
      // aussi ceux dont le nom ou la date de modif a changé (renommage, ré-encodage, ré-tag) — leur
      // ligne `tracks` est réécrite pour refléter le fichier réel, l'enrichissement (table séparée,
      // clé = id conservé) restant intact.
      const knownById = new Map(db.loadTracks().map((t) => [t.id, t]));
      const seen = new Set<string>();
      const toResolve: AssetMetadata[] = [];
      for (const meta of results) {
        seen.add(meta.id);
        const prev = knownById.get(meta.id);
        if (!prev || fileChanged(prev, meta)) {
          toResolve.push(meta);
        }
      }

      const newRows = await resolveRows(toResolve);
      for (const row of newRows) {
        db.ensureFolderPref(row.folder, !isAutoExcluded(row.folder));
      }
      db.upsertTracks(newRows);

      const removed = [...knownById.keys()].filter((id) => !seen.has(id));
      db.deleteTracks(removed);

      // Re-synchronise l'état en mémoire depuis la base (source de vérité).
      setAllTracks(db.loadTracks());
      setFolderPrefs(prefsToMap(db.loadFolderPrefs()));
      setExcludedIds(new Set(db.loadExcludedTracks()));
      toTag = newRows;
    } catch (e) {
      console.warn('[useAudioLibrary] scan failed', e);
      setError('Le scan de la bibliothèque a échoué.');
    } finally {
      setScanning(false);
    }

    // Passe 2 : tags + pochettes en fond, la biblio étant déjà affichée (titres = nom de fichier
    // en attendant). Reloads throttlés : `loadTracks` est un JOIN complet, on ne le rejoue pas
    // tous les 15 titres sur une grosse bibliothèque.
    if (toTag.length === 0 || seq !== scanSeq.current) {
      return;
    }
    setTagging(true);
    let lastReload = 0;
    try {
      await extractTagsInBatches(
        toTag,
        () => seq !== scanSeq.current,
        () => {
          const now = Date.now();
          if (now - lastReload >= 2500) {
            lastReload = now;
            setAllTracks(db.loadTracks());
          }
        }
      );
    } finally {
      if (seq === scanSeq.current) {
        // Reload final inconditionnel : le dernier lot doit toujours être visible.
        setAllTracks(db.loadTracks());
      }
      setTagging(false);
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

  // Rescan incrémental (bon marché : diff par id) au retour de l'app au premier plan — des
  // fichiers ont pu être ajoutés entre-temps. Débouncé : pas plus d'un scan toutes les 30 s.
  const lastForegroundScanRef = useRef(0);
  useEffect(() => {
    if (!isSupported || !permission?.granted) {
      return;
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        return;
      }
      const now = Date.now();
      if (now - lastForegroundScanRef.current < 30_000) {
        return;
      }
      lastForegroundScanRef.current = now;
      void scan();
    });
    return () => sub.remove();
  }, [permission?.granted, scan]);

  const isIncluded = useCallback((folder: string) => folderPrefs[folder] ?? true, [folderPrefs]);

  // Pistes visibles, non triées : base commune du tri des morceaux et des regroupements.
  const visibleTracks = useMemo(
    () => allTracks.filter((t) => isIncluded(t.folder) && !excludedIds.has(t.id)).map(rowToTrack),
    [allTracks, isIncluded, excludedIds]
  );

  const tracks = useMemo(() => sortTracks(visibleTracks, trackSort), [visibleTracks, trackSort]);

  // Vue fusionnée : les pistes multi-artistes sont rattachées aux artistes connus en solo.
  const artists = useMemo(() => buildMergedArtists(visibleTracks), [visibleTracks]);
  const albums = useMemo(() => buildAlbums(visibleTracks), [visibleTracks]);

  // Index sur *toutes* les pistes (pas seulement les visibles) : les playlists doivent pouvoir
  // résoudre une piste même si son dossier est exclu de l'affichage biblio.
  const tracksById = useMemo(() => {
    const map = new Map<string, LocalTrack>();
    for (const r of allTracks) {
      map.set(r.id, rowToTrack(r));
    }
    return map;
  }, [allTracks]);

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

  // Relecture SQLite pure (pas de scan) : source de vérité déjà à jour après une écriture hors scan.
  const reloadTracks = useCallback(() => setAllTracks(db.loadTracks()), []);

  // Vide le cache (pochettes disque + table `tracks` dérivée) puis relance un scan complet qui le
  // reconstruit. Renvoie les octets de pochettes libérés. Playlists/favoris/corrections préservés
  // (tables séparées). Le scan re-résout tous les fichiers (`tracks` vide → tout est « nouveau »).
  const clearCache = useCallback(async (): Promise<number> => {
    const freed = clearCoverCache();
    db.clearTrackCache();
    setAllTracks([]);
    await scan();
    return freed;
  }, [scan]);

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

  const setTracksExcluded = useCallback((ids: string[], excluded: boolean) => {
    if (ids.length === 0) {
      return;
    }
    db.setTracksExcluded(ids, excluded);
    setExcludedIds((prev) => {
      const nextSet = new Set(prev);
      for (const id of ids) {
        if (excluded) {
          nextSet.add(id);
        } else {
          nextSet.delete(id);
        }
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
    tracksById,
    refreshing: (scanning && hasCache) || tagging,
    tagging,
    error,
    folders,
    excludedTracks,
    requestPermission: () => void requestPermission(),
    rescan: () => void scan(),
    reloadTracks,
    clearCache,
    setFolderIncluded,
    setTrackExcluded,
    setTracksExcluded,
  };
}
