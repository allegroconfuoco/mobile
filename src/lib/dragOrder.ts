/**
 * Résolution de l'ordre affiché par une liste réordonnable optimiste (DraggableTrackList).
 *
 * Module pur (aucun import React Native) : la logique est vérifiable par harnais tsx hors device.
 */

/** Ordre optimiste en attente de confirmation par la source de vérité de l'appelant. */
export type PendingOrder = { ids: string[] };

/**
 * Résout l'ordre à afficher quand un nouveau `items` arrive hors glisser.
 *
 * Sans ça, tout `items` régénéré par le parent avec l'ordre PRÉ-déplacement (écriture différée
 * pas encore relue, snapshot natif en retard sur `PlaybackStateChanged`…) écraserait l'ordre
 * optimiste — le « snap-back » visible au lâcher. Règles :
 * - pas d'ordre en attente → `items` tel quel ;
 * - `items` dans l'ordre attendu → confirmation, l'attente est levée ;
 * - mêmes ids dans un autre ordre → écho périmé : contenu frais re-projeté dans l'ordre optimiste ;
 * - ensemble d'ids différent (ajout/retrait, ex. pull de synchro) → changement structurel, la
 *   source gagne et l'attente est levée.
 */
export function resolveIncomingOrder<T extends { id: string }>(
  incoming: T[],
  pending: PendingOrder | null
): { data: T[]; keepPending: boolean } {
  if (!pending) {
    return { data: incoming, keepPending: false };
  }
  const ids = incoming.map((item) => item.id);
  if (ids.length === pending.ids.length && ids.every((id, i) => id === pending.ids[i])) {
    return { data: incoming, keepPending: false };
  }
  if (!sameIdMultiset(ids, pending.ids)) {
    return { data: incoming, keepPending: false };
  }
  // Multiset (pas Map simple) : une même piste peut figurer deux fois dans une file de lecture.
  const buckets = new Map<string, T[]>();
  for (const item of incoming) {
    const bucket = buckets.get(item.id);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(item.id, [item]);
    }
  }
  const projected: T[] = [];
  for (const id of pending.ids) {
    const item = buckets.get(id)?.shift();
    if (!item) {
      return { data: incoming, keepPending: false };
    }
    projected.push(item);
  }
  return { data: projected, keepPending: true };
}

function sameIdMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const id of a) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const id of b) {
    const n = counts.get(id);
    if (!n) {
      return false;
    }
    counts.set(id, n - 1);
  }
  return true;
}
