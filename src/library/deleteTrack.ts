/**
 * Suppression **physique** d'un titre du téléphone (fichier + ligne media store).
 *
 * Passe par `Asset.delete()` de l'API media-library « Next » : sur Android 11+, c'est le système
 * qui affiche le dialogue de consentement (MediaStore) et supprime fichier + entrée du store d'un
 * coup — pas besoin de jongler avec MANAGE_EXTERNAL_STORAGE ici. Un refus utilisateur ou un échec
 * fait rejeter la promesse : indistinguables, traités pareil (rien n'est touché côté base).
 *
 * Après suppression on purge la ligne `tracks` locale pour un retrait immédiat de l'affichage
 * (sans attendre le prochain scan). Les tables satellites (enrichissement, favoris, playlists,
 * registre de synchro) sont **volontairement conservées** : même sémantique qu'un fichier disparu
 * entre deux scans — une entrée de playlist devient « indisponible », rien n'est cassé.
 */
import { Asset } from 'expo-media-library';

import * as db from './db';
import type { LocalTrack } from './useAudioLibrary';

/** Supprime le fichier du téléphone. `true` si supprimé, `false` si refusé/échoué (rien touché). */
export async function deleteTrackFromDevice(track: LocalTrack): Promise<boolean> {
  try {
    await new Asset(track.id).delete();
  } catch (e) {
    // Refus du dialogue système ou échec d'IO : on ne touche à rien.
    console.warn('[deleteTrack]', e);
    return false;
  }
  db.deleteTracks([track.id]);
  return true;
}
