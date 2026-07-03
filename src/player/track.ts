import { Asset } from 'expo-media-library';
import type { Track } from 'react-native-track-player';

import { type LocalTrack } from '@/library/useAudioLibrary';
import { peekTrackTags, readTrackTags } from '@/library/trackTags';

/**
 * Convertit une piste de la bibliothèque locale en piste react-native-track-player.
 *
 * Deux résolutions à la demande :
 * - l'URI réelle du fichier (`Asset.getUri()` → `file://` sur Android), que le scan ne
 *   garde pas en mémoire pour ne pas la résoudre pour des milliers de titres jamais lus ;
 * - les tags ID3 (titre/artiste/album/pochette), déjà en cache s'ils ont été lus par la
 *   liste, sinon lus ici pour que la notification média affiche des métadonnées correctes.
 *
 * On conserve l'`id` du media store sur la piste (champ libre accepté par RNTP) : il sert à
 * retrouver quelle `LocalTrack` joue à partir de `useActiveTrack`.
 */
export async function toPlayerTrack(local: LocalTrack): Promise<Track> {
  const url = await new Asset(local.id).getUri();
  const tags = peekTrackTags(local.id) ?? (await readTrackTags(local.id));

  return {
    id: local.id,
    url,
    title: tags?.title ?? local.title,
    artist: tags?.artist ?? 'Artiste inconnu',
    album: tags?.album ?? undefined,
    artwork: tags?.artworkUri ?? undefined,
    duration: local.durationMs != null ? local.durationMs / 1000 : undefined,
  };
}
