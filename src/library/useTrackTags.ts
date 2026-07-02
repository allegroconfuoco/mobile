import { useEffect, useState } from 'react';

import { peekTrackTags, readTrackTags, type TrackTags } from './trackTags';

/**
 * Lit paresseusement les tags ID3 d'une piste au montage de sa ligne.
 *
 * Volontairement par ligne : une `FlatList` ne monte que les lignes visibles, donc on
 * n'ouvre que les fichiers réellement affichés. Le résultat est mis en cache (voir
 * `trackTags`), donc un re-montage lors d'un défilement ne relit pas le fichier.
 */
export function useTrackTags(assetId: string): { tags: TrackTags | null; loading: boolean } {
  // Si déjà en cache, on rend les tags dès le premier frame (pas de flash de repli).
  // `FlatList` ne recycle pas les instances (clé par `id`) : `assetId` est stable ici,
  // donc lire le cache à l'initialisation suffit, l'effet ne gère que le cas non résolu.
  const [tags, setTags] = useState<TrackTags | null>(() => peekTrackTags(assetId));
  const [loading, setLoading] = useState(tags === null);

  useEffect(() => {
    if (peekTrackTags(assetId)) {
      return;
    }
    let active = true;
    // Le setState vit dans un callback asynchrone (synchronisation avec la lecture
    // fichier, un système externe), pas dans le corps de l'effet.
    readTrackTags(assetId)
      .then((resolved) => {
        if (active) {
          setTags(resolved);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [assetId]);

  return { tags, loading };
}
