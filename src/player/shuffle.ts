/**
 * Helpers purs pour le shuffle de la file (finition Phase 1).
 *
 * react-native-track-player n'a **pas** de shuffle natif : on réordonne la file nous-mêmes par une
 * suite de `move(from, to)`. Ces fonctions ne touchent à rien (pas d'IO, pas de RNTP) — elles
 * calculent seulement des ordres cibles et la séquence de déplacements pour y arriver, ce qui les
 * rend testables et garde `PlayerProvider` lisible.
 */

/** Mélange une copie du tableau (Fisher-Yates). N'affecte pas l'entrée. */
export function shuffled<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Ordre cible d'un shuffle : on **garde en place** les pistes jusqu'à `activeIndex` inclus (dont
 * la piste en cours de lecture, qu'on ne veut pas déplacer) et on mélange uniquement la suite.
 * `activeIndex < 0` (file sans piste active) ⇒ on mélange tout.
 */
export function shuffleAfter(ids: readonly string[], activeIndex: number): string[] {
  const pivot = Math.max(-1, activeIndex);
  const head = ids.slice(0, pivot + 1);
  const tail = shuffled(ids.slice(pivot + 1));
  return [...head, ...tail];
}

/**
 * Restaure `original` en ne gardant que les ids encore présents dans `current`, puis en ajoutant
 * à la fin les ids de `current` absents de `original` (pistes ajoutées pendant le shuffle), dans
 * leur ordre courant. Le résultat est toujours une permutation de `current`.
 */
export function restoreOrder(current: readonly string[], original: readonly string[]): string[] {
  const currentSet = new Set(current);
  const kept = original.filter((id) => currentSet.has(id));
  const keptSet = new Set(kept);
  const extras = current.filter((id) => !keptSet.has(id));
  return [...kept, ...extras];
}

/**
 * Séquence de déplacements `[from, to]` transformant `currentIds` en `targetIds`.
 *
 * On simule chaque `move` sur une copie locale : appliquée dans l'ordre à la vraie file (via
 * `TrackPlayer.move`), elle reproduit exactement la simulation. `targetIds` doit être une
 * permutation de `currentIds` (les ids absents de `current` sont ignorés sans risque).
 */
export function planMoves(
  currentIds: readonly string[],
  targetIds: readonly string[]
): [number, number][] {
  const arr = [...currentIds];
  const moves: [number, number][] = [];
  for (let i = 0; i < targetIds.length && i < arr.length; i++) {
    if (arr[i] === targetIds[i]) {
      continue;
    }
    const from = arr.indexOf(targetIds[i], i);
    if (from === -1) {
      continue; // id cible absent de la file courante : on saute.
    }
    const [moved] = arr.splice(from, 1);
    arr.splice(i, 0, moved);
    moves.push([from, i]);
  }
  return moves;
}
