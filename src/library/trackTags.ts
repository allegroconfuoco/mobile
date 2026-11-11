/**
 * Lecture des tags d'un fichier audio — couche IO native, appelée uniquement par le scan.
 *
 * Lecture *partielle* du fichier (uniquement l'en-tête ID3, pas tout le MP3) → parsing pur JS
 * (`./id3`) → extraction de la pochette, écrite en cache disque. Les tags texte partent ensuite
 * en base (`db.updateScannedTags`) : c'est la base, rechargée au démarrage, qui sert l'affichage
 * et la lecture — rien n'est relu dans les fichiers en dehors du scan.
 *
 * La pochette est persistée sur disque ; on ne garde que son URI, jamais les octets.
 */
import { Platform } from 'react-native';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { hasId3v2, id3v2BodySize, mergeTags, parseId3v1, parseId3v2, type ParsedTags } from './id3';

/** Tags résolus pour une piste, prêts à afficher. `null` = champ indisponible. */
export type TrackTags = {
  title: string | null;
  artist: string | null;
  album: string | null;
  /** Artiste de l'album (TPE2), pour regrouper les compilations, ou `null`. */
  albumArtist: string | null;
  /** Numéro de piste (TRCK), pour ordonner au sein d'un disque, ou `null`. */
  trackNo: number | null;
  /** Numéro de disque (TPOS), pour ordonner un album multi-disques, ou `null`. */
  discNo: number | null;
  /** URI `file://` d'une pochette extraite et mise en cache, ou `null`. */
  artworkUri: string | null;
};

const EMPTY_TAGS: TrackTags = {
  title: null,
  artist: null,
  album: null,
  albumArtist: null,
  trackNo: null,
  discNo: null,
  artworkUri: null,
};

const isSupported = Platform.OS !== 'web';

const COVERS_DIR = 'track-covers';

function coversDirectory(): Directory {
  const dir = new Directory(Paths.cache, COVERS_DIR);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
}

/** Taille totale (octets) des pochettes en cache disque. 0 sur web ou si le dossier n'existe pas. */
export function coverCacheSize(): number {
  if (!isSupported) {
    return 0;
  }
  try {
    const dir = new Directory(Paths.cache, COVERS_DIR);
    if (!dir.exists) {
      return 0;
    }
    let total = 0;
    for (const entry of dir.list()) {
      if (entry instanceof File) {
        total += entry.size ?? 0;
      }
    }
    return total;
  } catch (e) {
    console.warn('[trackTags] taille du cache pochettes illisible', e);
    return 0;
  }
}

/**
 * Vide le cache des pochettes : supprime le dossier disque. Purement dérivé des fichiers : les
 * pochettes sont ré-extraites au prochain scan. Renvoie le nombre d'octets libérés (0 sur web).
 */
export function clearCoverCache(): number {
  if (!isSupported) {
    return 0;
  }
  const freed = coverCacheSize();
  try {
    const dir = new Directory(Paths.cache, COVERS_DIR);
    if (dir.exists) {
      dir.delete();
    }
  } catch (e) {
    console.warn('[trackTags] échec vidage du cache pochettes', e);
    return 0;
  }
  return freed;
}

function extensionForMime(mime: string): string {
  if (mime === 'image/png') {
    return 'png';
  }
  if (mime === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

/** Nom de fichier de cache stable et sûr, dérivé de l'ID du media store. */
function coverFilename(assetId: string, mime: string): string {
  const safe = assetId.replace(/[^a-zA-Z0-9]+/g, '_');
  return `${safe}.${extensionForMime(mime)}`;
}

/** Écrit la pochette en cache si absente et renvoie son URI `file://`. */
function persistCover(assetId: string, mime: string, data: Uint8Array): string | null {
  try {
    const file = new File(coversDirectory(), coverFilename(assetId, mime));
    if (!file.exists) {
      file.write(data);
    }
    return file.uri;
  } catch (e) {
    console.warn('[trackTags] échec écriture pochette', e);
    return null;
  }
}

/**
 * Lit le tag ID3v2 en tête de fichier via une lecture partielle, avec repli ID3v1.
 * Ne lit jamais le fichier entier : seulement l'en-tête ID3 (pochette comprise).
 */
function readParsedTags(uri: string): ParsedTags | null {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? 0;
    let v2: ParsedTags | null = null;

    const header = handle.readBytes(10);
    if (header.length >= 10 && hasId3v2(header)) {
      const bodySize = id3v2BodySize(header);
      if (bodySize > 0) {
        const body = handle.readBytes(bodySize);
        v2 = parseId3v2(header, body);
      }
    }

    // Repli ID3v1 (fin de fichier) tant qu'il manque un champ texte.
    if (size >= 128 && (!v2 || !v2.title || !v2.artist || !v2.album)) {
      handle.offset = size - 128;
      const trailer = handle.readBytes(128);
      const v1 = parseId3v1(trailer);
      if (v1) {
        return mergeTags(v2, v1);
      }
    }

    return v2;
  } finally {
    handle.close();
  }
}

/**
 * Extrait les tags d'une piste dont l'URI `file://` est déjà connue (résolue par le scan).
 * Entièrement synchrone : lecture partielle + parsing + écriture de la pochette.
 */
export function extractTrackTags(assetId: string, uri: string): TrackTags {
  if (!isSupported) {
    return EMPTY_TAGS;
  }
  let parsed: ParsedTags | null = null;
  try {
    parsed = readParsedTags(uri);
  } catch (e) {
    // Fichier illisible ou tag corrompu : on dégrade proprement vers des champs vides.
    console.warn('[trackTags] lecture des tags échouée', e);
  }

  const artworkUri =
    parsed?.picture && parsed.picture.data.length > 0
      ? persistCover(assetId, parsed.picture.mime, parsed.picture.data)
      : null;

  const tags: TrackTags = {
    title: parsed?.title ?? null,
    artist: parsed?.artist ?? null,
    album: parsed?.album ?? null,
    albumArtist: parsed?.albumArtist ?? null,
    trackNo: parsed?.trackNo ?? null,
    discNo: parsed?.discNo ?? null,
    artworkUri,
  };
  return tags;
}
