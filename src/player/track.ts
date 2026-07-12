import { Asset } from 'expo-media-library';
import type { MediaItem } from '@rntp/player';

import { type LocalTrack } from '@/library/useAudioLibrary';
import { peekTrackTags, readTrackTags } from '@/library/trackTags';

/**
 * Convertit une piste de la bibliothèque locale en `MediaItem` @rntp/player.
 *
 * Deux résolutions à la demande :
 * - l'URI réelle du fichier (`Asset.getUri()` → `file://` sur Android), que le scan ne
 *   garde pas en mémoire pour ne pas la résoudre pour des milliers de titres jamais lus ;
 * - les tags ID3 (titre/artiste/album/pochette), déjà en cache s'ils ont été lus par la
 *   liste, sinon lus ici pour que la notification média affiche des métadonnées correctes.
 *
 * `mediaId` = id du media store : il sert à retrouver quelle `LocalTrack` joue à partir du
 * snapshot de file (`useQueue`) — identité stable, indépendante de l'ordre.
 */
export async function toPlayerTrack(local: LocalTrack): Promise<MediaItem> {
  const url = await new Asset(local.id).getUri();
  const tags = peekTrackTags(local.id) ?? (await readTrackTags(local.id));

  return {
    mediaId: local.id,
    url,
    title: tags?.title ?? local.title,
    artist: tags?.artist ?? 'Artiste inconnu',
    // Repli sur l'enrichissement MusicBrainz (issue #19) : album et pochette distante quand le
    // fichier n'embarque ni tag album ni pochette (artworkUrl accepte une URL distante).
    albumTitle: tags?.album ?? local.album ?? undefined,
    artworkUrl: tags?.artworkUri ?? local.coverArtUrl ?? undefined,
    duration: local.durationMs != null ? local.durationMs / 1000 : undefined,
  };
}

/**
 * Résout une liste de pistes locales en `MediaItem[]`.
 *
 * Les résolutions sont faites en parallèle ; toute piste dont l'URI est introuvable est
 * ignorée (et journalisée) plutôt que de faire échouer l'ensemble. On garde donc une file
 * cohérente même si un fichier a disparu entre le scan et la lecture.
 */
export async function resolvePlayerTracks(locals: LocalTrack[]): Promise<MediaItem[]> {
  const resolved = await Promise.all(
    locals.map(async (local) => {
      try {
        return await toPlayerTrack(local);
      } catch (e) {
        console.warn('[player] URI introuvable, piste ignorée', local.filename, e);
        return null;
      }
    })
  );
  return resolved.filter((track): track is MediaItem => track !== null);
}
