import type { MediaItem } from '@rntp/player';

import { type LocalTrack } from '@/library/useAudioLibrary';

/**
 * Convertit une piste de la bibliothèque locale en `MediaItem` @rntp/player — **sans aucune IO**.
 *
 * Tout ce dont le lecteur a besoin est déjà en mémoire : le scan a résolu l'URI `file://` du
 * fichier et lu ses tags, le tout persisté en base puis rechargé au démarrage. Construire la file
 * est donc une simple projection synchrone.
 *
 * C'était le principal frein au « tap → son » : la version précédente résolvait l'URI de **chaque**
 * piste de la file (`Asset.getUri()`, un aller-retour natif par titre) avant de lancer quoi que ce
 * soit. Taper un morceau dans une bibliothèque de 2 000 titres attendait 2 000 résolutions.
 *
 * `mediaId` = id du media store : il sert à retrouver quelle `LocalTrack` joue à partir du
 * snapshot de file (`useQueue`) — identité stable, indépendante de l'ordre.
 */
export function toMediaItem(local: LocalTrack): MediaItem | null {
  // Repli sur l'id quand le scan n'a pas pu résoudre le chemin : sur Android c'est l'URI
  // `content://` du media store, que le lecteur sait ouvrir directement.
  const url = local.uri ?? (local.id.startsWith('content://') ? local.id : null);
  if (!url) {
    return null;
  }
  return {
    mediaId: local.id,
    url,
    title: local.title,
    artist: local.artist ?? 'Artiste inconnu',
    albumTitle: local.album ?? undefined,
    artworkUrl: local.artworkUri ?? undefined,
    duration: local.durationMs != null ? local.durationMs / 1000 : undefined,
  };
}

/**
 * Projette une liste de pistes locales en `MediaItem[]`. Une piste sans URI exploitable est
 * simplement omise : la file reste cohérente même si un fichier est illisible.
 */
export function toMediaItems(locals: LocalTrack[]): MediaItem[] {
  const items: MediaItem[] = [];
  for (const local of locals) {
    const item = toMediaItem(local);
    if (item) {
      items.push(item);
    }
  }
  return items;
}
