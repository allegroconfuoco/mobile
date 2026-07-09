/**
 * Gravure des tags dans le fichier (write-back ID3) — couche IO native.
 *
 * Modèle **hybride** (cf. migration v9 de `db.ts`) : l'overlay `track_enrichment` reste la vérité
 * affichée et synchronisée entre appareils ; ici on offre à l'utilisateur de *graver* les infos
 * corrigées dans le MP3 lui-même, pour avoir des **fichiers propres** portables hors de l'app
 * (philosophie data-ownership). Chaque gravure sauvegarde d'abord les tags d'origine (une fois) pour
 * pouvoir restaurer.
 *
 * ⚠️ Accès en écriture Android : modifier un fichier de la bibliothèque partagée (que l'app n'a pas
 * créé) est bloqué par le scoped storage. On s'appuie sur la permission spéciale
 * `MANAGE_EXTERNAL_STORAGE` (« accès à tous les fichiers »), cohérente avec un usage perso/sideload
 * (cf. PROJET.md). Elle ne se demande pas via un prompt runtime classique : on tente l'écriture, et
 * en cas d'échec de permission on envoie l'utilisateur dans les réglages système via
 * `requestAllFilesAccess`, puis il relance la gravure.
 *
 * Ne grave que ce que le reader/writer gèrent (MP3/ID3). Sur web (hors périmètre), no-op.
 */
import { Alert, Platform } from 'react-native';
import { Asset } from 'expo-media-library';
import { File, FileMode } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';

import { showToast } from '@/components/Toast';
import { hasId3v2, id3v2BodySize, parseId3v2, type ParsedTags } from './id3';
import { buildId3v2, replaceId3, type WritablePicture, type WritableTags } from './id3Writer';
import * as db from './db';
import type { LocalTrack } from './useAudioLibrary';
import type { CoverChoice } from './writeReview';

const isSupported = Platform.OS !== 'web';

/**
 * Ce qu'on grave concrètement : un jeu de tags texte (issu de la revue, `reviewToTags`) + un choix
 * de pochette. Sans spec, `graveTags` retombe sur son ancien comportement (dérive du `LocalTrack`,
 * pochette conservée sinon distante) — conservé pour ne rien casser d'un éventuel appelant direct.
 */
export type WriteSpec = { tags: db.TagBackup; cover: CoverChoice };

/** Issue d'une tentative d'écriture. */
export type WriteResult =
  | 'written' // tags gravés dans le fichier
  | 'permission-needed' // écriture refusée : accès à tous les fichiers à accorder
  | 'no-backup' // restauration demandée alors qu'aucune sauvegarde n'existe
  | 'unsupported' // plateforme sans accès fichier (web)
  | 'error'; // autre échec (fichier illisible, URI introuvable…)

/** Lit tout le fichier en mémoire (nécessaire pour réécrire l'en-tête tout en gardant l'audio). */
function readWholeFile(uri: string): Uint8Array {
  const handle = new File(uri).open(FileMode.ReadOnly);
  try {
    return handle.readBytes(handle.size ?? 0);
  } finally {
    handle.close();
  }
}

/** Parse le tag ID3v2 en tête (pour la pochette existante + la sauvegarde), ou `{}` si absent. */
function parseExisting(bytes: Uint8Array): ParsedTags {
  if (bytes.length >= 10 && hasId3v2(bytes.subarray(0, 10))) {
    const bodySize = id3v2BodySize(bytes.subarray(0, 10));
    if (bodySize > 0 && 10 + bodySize <= bytes.length) {
      return parseId3v2(bytes.subarray(0, 10), bytes.subarray(10, 10 + bodySize));
    }
  }
  return {};
}

/** Télécharge une pochette distante (Cover Art Archive) pour l'embarquer. Best-effort. */
async function fetchPicture(url: string): Promise<WritablePicture | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.length === 0) {
      return null;
    }
    const mime = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
    return { mime: mime || 'image/jpeg', data };
  } catch {
    return null;
  }
}

/** Convertit des `ParsedTags` (lus dans le fichier) en `TagBackup` (tags texte d'origine). */
function toBackup(tags: ParsedTags): db.TagBackup {
  return {
    title: tags.title ?? null,
    artist: tags.artist ?? null,
    album: tags.album ?? null,
    albumArtist: tags.albumArtist ?? null,
    trackNo: tags.trackNo ?? null,
    discNo: tags.discNo ?? null,
  };
}

/** Champs de tags d'une piste résolue (overlay compris), tels qu'on veut les graver. */
function trackToTags(track: LocalTrack): db.TagBackup {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    trackNo: track.trackNo,
    discNo: track.discNo,
  };
}

/** Détermine si un échec d'écriture est un problème de permission (→ accès à tous les fichiers). */
function isPermissionError(e: unknown): boolean {
  const msg = String(e instanceof Error ? e.message : e).toLowerCase();
  // Écriture refusée par le scoped storage : messages variables selon l'OEM/couche native.
  return (
    msg.includes('permission') ||
    msg.includes('denied') ||
    msg.includes('eacces') ||
    msg.includes('eperm') ||
    msg.includes('erofs') ||
    msg.includes('read-only') ||
    msg.includes('not writable') ||
    msg.includes('operation not permitted')
  );
}

/**
 * Écrit `newFile` (octets complets) à l'emplacement `uri`, en distinguant un refus de permission
 * d'une vraie erreur. Un échec dont on ne reconnaît pas la cause est **traité comme un problème de
 * permission** : sur Android c'est de très loin la cause première pour cette fonctionnalité, et le
 * pire cas (une corruption étiquetée « permission ») n'envoie qu'un dialogue vers les réglages, pas
 * une boucle. L'erreur brute est loguée pour diagnostic.
 */
function writeFile(uri: string, newFile: Uint8Array): WriteResult {
  try {
    new File(uri).write(newFile);
    return 'written';
  } catch (e) {
    if (!isPermissionError(e)) {
      console.warn('[writeTags] échec d’écriture (traité comme permission)', e);
    }
    return 'permission-needed';
  }
}

/**
 * Résout la pochette à graver selon le choix de la revue et ce que le fichier contient déjà.
 * `keep` = pochette du fichier (ou aucune) ; `remote` = pochette distante Cover Art Archive, repli
 * sur celle du fichier si le téléchargement échoue ; `none` = aucune (on retire la pochette).
 */
async function resolvePicture(
  choice: CoverChoice,
  existing: WritablePicture | null,
  remoteUrl: string | null
): Promise<WritablePicture | null> {
  if (choice === 'none') {
    return null;
  }
  if (choice === 'remote') {
    const fetched = remoteUrl ? await fetchPicture(remoteUrl) : null;
    return fetched ?? existing;
  }
  return existing; // 'keep'
}

/**
 * Grave les infos de `track` (titre/artiste/album/album-artist/n° piste/n° disque + une pochette)
 * dans son fichier MP3. Sauvegarde d'abord les tags d'origine (une seule fois). Reflète l'écriture
 * dans `tracks` (immédiateté ; un futur scan reconcilie via la date de modif qui change). Renvoie
 * l'issue ; l'appelant gère le dialogue de permission au besoin.
 *
 * Avec `spec` (venu de la revue avant gravure), grave exactement `spec.tags` + `spec.cover`. Sans
 * `spec`, retombe sur l'ancien comportement (tags résolus du `LocalTrack`, pochette conservée sinon
 * distante).
 */
export async function graveTags(track: LocalTrack, spec?: WriteSpec): Promise<WriteResult> {
  if (!isSupported) {
    return 'unsupported';
  }
  let uri: string;
  try {
    uri = await new Asset(track.id).getUri();
  } catch (e) {
    console.warn('[writeTags] URI introuvable', e);
    return 'error';
  }

  let original: Uint8Array;
  let existing: ParsedTags;
  try {
    original = readWholeFile(uri);
    existing = parseExisting(original);
  } catch (e) {
    console.warn('[writeTags] lecture du fichier échouée', e);
    return 'error';
  }

  const existingPic: WritablePicture | null =
    existing.picture && existing.picture.data.length > 0
      ? { mime: existing.picture.mime, data: existing.picture.data }
      : null;
  // Sans spec : conserver la pochette du fichier, sinon embarquer la distante (comportement legacy).
  const coverChoice: CoverChoice = spec ? spec.cover : existingPic ? 'keep' : 'remote';
  const picture = await resolvePicture(coverChoice, existingPic, track.coverArtUrl);

  const fields = spec ? spec.tags : trackToTags(track);
  const target: WritableTags = { ...fields, picture };

  // Sauvegarde des tags d'origine AVANT d'écrire (idempotent : seule la première gravure compte).
  db.saveTagBackup(track.id, toBackup(existing), Date.now());

  const newFile = replaceId3(original, buildId3v2(target));
  const result = writeFile(uri, newFile);
  if (result === 'written') {
    db.updateTrackTags(track.id, fields);
  }
  return result;
}

/** Bilan d'une gravure en lot. `writtenIds` = pistes effectivement écrites (pour un nettoyage aval). */
export type BulkGraveOutcome = {
  written: number;
  failed: number;
  /** Vrai si on s'est arrêté sur un refus de permission (accès à tous les fichiers à accorder). */
  permission: boolean;
  writtenIds: string[];
};

/**
 * Grave un lot de pistes, une par une (l'écriture fichier n'est pas parallélisable proprement), en
 * s'arrêtant au **premier refus de permission** pour ne pas empiler N dialogues système. `onProgress`
 * reçoit le nombre de pistes traitées. Mutualisé entre la revue avant gravure (`write-tags`) et les
 * outils d'édition en lot (associer un artiste, dissocier des albums).
 */
export async function graveMany(
  items: { track: LocalTrack; spec: WriteSpec }[],
  onProgress?: (done: number) => void
): Promise<BulkGraveOutcome> {
  let written = 0;
  let failed = 0;
  let permission = false;
  const writtenIds: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const { track, spec } = items[i];
    const result = await graveTags(track, spec);
    if (result === 'written') {
      written += 1;
      writtenIds.push(track.id);
    } else if (result === 'permission-needed') {
      permission = true;
      break;
    } else {
      failed += 1;
    }
    onProgress?.(i + 1);
  }
  return { written, failed, permission, writtenIds };
}

/**
 * Restaure les tags d'origine d'une piste (sauvegardés avant sa première gravure) dans le fichier.
 * Ne restaure que les **tags texte** : la pochette éventuellement embarquée à la gravure est
 * conservée (les octets d'image n'ont pas été sauvegardés, cf. migration v9).
 */
export async function restoreTags(track: LocalTrack): Promise<WriteResult> {
  if (!isSupported) {
    return 'unsupported';
  }
  const backup = db.loadTagBackup(track.id);
  if (!backup) {
    return 'no-backup';
  }
  let uri: string;
  try {
    uri = await new Asset(track.id).getUri();
  } catch (e) {
    console.warn('[writeTags] URI introuvable', e);
    return 'error';
  }

  let original: Uint8Array;
  let existing: ParsedTags;
  try {
    original = readWholeFile(uri);
    existing = parseExisting(original);
  } catch (e) {
    console.warn('[writeTags] lecture du fichier échouée', e);
    return 'error';
  }

  const picture: WritablePicture | null =
    existing.picture && existing.picture.data.length > 0
      ? { mime: existing.picture.mime, data: existing.picture.data }
      : null;
  const target: WritableTags = { ...backup, picture };

  const newFile = replaceId3(original, buildId3v2(target));
  const result = writeFile(uri, newFile);
  if (result === 'written') {
    db.updateTrackTags(track.id, backup);
  }
  return result;
}

/**
 * Envoie l'utilisateur accorder l'« accès à tous les fichiers » à Fuoco (permission
 * `MANAGE_EXTERNAL_STORAGE`). On cible d'abord la page dédiée de l'app ; repli sur la liste générale
 * si l'OEM ne connaît pas l'action app-spécifique. À appeler quand une gravure renvoie
 * `permission-needed`.
 */
export async function requestAllFilesAccess(): Promise<void> {
  if (!isSupported) {
    return;
  }
  const pkg = Application.applicationId;
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION',
      pkg ? { data: `package:${pkg}` } : undefined
    );
  } catch {
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION'
      );
    } catch (e) {
      console.warn('[writeTags] ouverture des réglages d’accès fichiers impossible', e);
    }
  }
}

// --- Flux UI : confirmation + feedback (mutualisé entre consommateurs) ------------------------

/**
 * Dialogue « permission à accorder » commun à la gravure et à la restauration. Exporté pour que
 * l'écran de revue (gravure 1 piste / lot) l'affiche lui-même après un `permission-needed`.
 */
export function alertPermissionNeeded(retryHint: string): void {
  Alert.alert(
    'Autorisation requise',
    `Pour modifier tes fichiers musicaux, Fuoco a besoin de l’accès à tous les fichiers. Ouvrir les réglages ? ${retryHint}`,
    [
      { text: 'Plus tard', style: 'cancel' },
      { text: 'Ouvrir les réglages', onPress: () => void requestAllFilesAccess() },
    ]
  );
}

async function runRestore(track: LocalTrack, onWritten: () => void): Promise<void> {
  const result = await restoreTags(track);
  if (result === 'written') {
    onWritten();
    showToast('Tags d’origine restaurés', 'settings_backup_restore');
  } else if (result === 'permission-needed') {
    alertPermissionNeeded('Relance ensuite la restauration.');
  } else if (result === 'no-backup') {
    Alert.alert('Rien à restaurer', 'Aucune sauvegarde des tags d’origine pour cette piste.');
  } else {
    Alert.alert('Échec', 'Impossible de restaurer les tags.');
  }
}

/** Demande confirmation puis restaure les tags d'origine dans le fichier, avec retour utilisateur. */
export function confirmRestoreTags(track: LocalTrack, onWritten: () => void): void {
  Alert.alert(
    'Restaurer les tags d’origine',
    `Réécrire les tags d’origine dans « ${track.filename} » ?`,
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Restaurer', onPress: () => void runRestore(track, onWritten) },
    ]
  );
}
