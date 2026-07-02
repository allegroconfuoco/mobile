import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  type AssetMetadata,
  AssetField,
  MediaType,
  Query,
  usePermissions,
} from 'expo-media-library';

/**
 * Un morceau audio détecté sur l'appareil.
 *
 * Volontairement minimal : le scan ne lit que les métadonnées légères du media store
 * (`Query.exeForMetadata`), sans résoudre l'URI ni décoder les fichiers. L'URI réelle
 * (nécessaire à la lecture) sera résolue à la demande via `new Asset(id).getUri()`.
 */
export type LocalTrack = {
  /** ID du media store (contentUri Android) — sert à ré-instancier un `Asset`. */
  id: string;
  /** Titre affiché : nom de fichier sans extension. */
  title: string;
  /** Nom de fichier complet, extension comprise. */
  filename: string;
  /** Durée en millisecondes, ou `null` si le media store ne la connaît pas. */
  durationMs: number | null;
};

/** État de haut niveau de la bibliothèque, consommé directement par l'UI. */
export type LibraryStatus =
  | 'loading' // permission en cours de résolution
  | 'unsupported' // plateforme sans media store (web)
  | 'undetermined' // permission demandable (jamais demandée, ou refus « ré-essayable »)
  | 'denied' // permission refusée définitivement → réglages système
  | 'scanning' // permission accordée, scan en cours
  | 'ready'; // permission accordée, scan terminé

// Le media store n'existe pas sur le web : on court-circuite pour ne pas planter l'export.
const isSupported = Platform.OS !== 'web';

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function toTrack(meta: AssetMetadata): LocalTrack {
  const filename = meta.filename ?? 'Fichier inconnu';
  return {
    id: meta.id,
    filename,
    title: meta.filename ? stripExtension(meta.filename) : 'Titre inconnu',
    durationMs: meta.duration,
  };
}

type UseAudioLibrary = {
  status: LibraryStatus;
  tracks: LocalTrack[];
  error: string | null;
  /** Demande la permission `READ_MEDIA_AUDIO` (Android 13+). */
  requestPermission: () => void;
  /** Relance un scan (accordé uniquement). */
  rescan: () => void;
};

/**
 * Découvre les fichiers audio de l'appareil.
 *
 * Enchaîne : demande de permission granulaire `audio` → scan du media store → liste de
 * `LocalTrack`. Le scan se déclenche automatiquement dès que la permission est accordée.
 */
export function useAudioLibrary(): UseAudioLibrary {
  const [permission, requestPermission] = usePermissions({
    granularPermissions: ['audio'],
  });
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setTracks(results.map(toTrack));
    } catch (e) {
      console.warn('[useAudioLibrary] scan failed', e);
      setError('Le scan de la bibliothèque a échoué.');
    } finally {
      setScanning(false);
    }
  }, []);

  // Scan automatique dès que l'accès est accordé (au montage ou après acceptation).
  // Synchronisation légitime avec une source externe (le media store) : le setState
  // synchrone de `scan` (setScanning) est voulu ici pour afficher l'état « analyse ».
  useEffect(() => {
    if (permission?.granted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void scan();
    }
  }, [permission?.granted, scan]);

  let status: LibraryStatus;
  if (!isSupported) {
    status = 'unsupported';
  } else if (!permission) {
    status = 'loading';
  } else if (permission.granted) {
    status = scanning ? 'scanning' : 'ready';
  } else if (permission.canAskAgain) {
    status = 'undetermined';
  } else {
    status = 'denied';
  }

  return {
    status,
    tracks,
    error,
    requestPermission: () => void requestPermission(),
    rescan: () => void scan(),
  };
}
