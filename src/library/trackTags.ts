/**
 * Lecture des tags d'un fichier audio du media store — couche IO native.
 *
 * Enchaîne : `Asset.getUri()` (→ chemin `file://` sur Android) → lecture *partielle* du
 * fichier (uniquement l'en-tête ID3, pas tout le MP3) → parsing pur JS (`./id3`) →
 * extraction de la pochette écrite en cache disque.
 *
 * Deux caches pour éviter de relire à chaque rendu de ligne :
 * - `tagsCache` : les tags texte (petits) restent en mémoire pour la session.
 * - la pochette est persistée sur disque ; on ne garde que son URI, jamais les octets.
 *   Sur une biblio de milliers de titres, ça évite de saturer la mémoire.
 */
import { Platform } from 'react-native';
import { Asset } from 'expo-media-library';
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { hasId3v2, id3v2BodySize, mergeTags, parseId3v1, parseId3v2, type ParsedTags } from './id3';

/** Tags résolus pour une piste, prêts à afficher. `null` = champ indisponible. */
export type TrackTags = {
  title: string | null;
  artist: string | null;
  album: string | null;
  /** URI `file://` d'une pochette extraite et mise en cache, ou `null`. */
  artworkUri: string | null;
};

const EMPTY_TAGS: TrackTags = { title: null, artist: null, album: null, artworkUri: null };

const isSupported = Platform.OS !== 'web';

// Cache mémoire des tags résolus + déduplication des lectures concurrentes.
const tagsCache = new Map<string, TrackTags>();
const inFlight = new Map<string, Promise<TrackTags>>();

const COVERS_DIR = 'track-covers';

function coversDirectory(): Directory {
  const dir = new Directory(Paths.cache, COVERS_DIR);
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
  return dir;
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

async function resolveTags(assetId: string): Promise<TrackTags> {
  if (!isSupported) {
    return EMPTY_TAGS;
  }
  let uri: string;
  try {
    uri = await new Asset(assetId).getUri();
  } catch (e) {
    console.warn('[trackTags] URI introuvable', e);
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

  return {
    title: parsed?.title ?? null,
    artist: parsed?.artist ?? null,
    album: parsed?.album ?? null,
    artworkUri,
  };
}

/**
 * Résout les tags d'une piste (idempotent, mis en cache).
 *
 * Les appels concurrents pour le même `assetId` partagent une seule lecture.
 */
export function readTrackTags(assetId: string): Promise<TrackTags> {
  const cached = tagsCache.get(assetId);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = inFlight.get(assetId);
  if (pending) {
    return pending;
  }
  const promise = resolveTags(assetId)
    .then((tags) => {
      tagsCache.set(assetId, tags);
      return tags;
    })
    .finally(() => {
      inFlight.delete(assetId);
    });
  inFlight.set(assetId, promise);
  return promise;
}

/** Tags déjà en cache pour cet ID, ou `null` si pas encore lus. */
export function peekTrackTags(assetId: string): TrackTags | null {
  return tagsCache.get(assetId) ?? null;
}
