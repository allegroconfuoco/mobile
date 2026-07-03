/**
 * Dérivation du dossier d'une piste + heuristique d'auto-exclusion.
 *
 * Pur (aucune I/O) : alimenté par l'URI `file://` résolue au scan (`Asset.getUri()`), il sert à
 * regrouper les pistes par dossier et à décider quels dossiers exclure par défaut (sonneries,
 * notifications, sons d'apps…). Testable et sans dépendance native.
 */

/**
 * Dossier parent d'une URI de fichier (`file:///…/Music/x.mp3` → `/storage/emulated/0/Music`).
 *
 * On enlève le schéma `file://`, on décode les `%20` etc., puis on coupe au dernier `/`.
 * Renvoie `''` si l'URI n'a pas de segment de dossier exploitable.
 */
export function folderOf(uri: string): string {
  let path = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  try {
    path = decodeURIComponent(path);
  } catch {
    // URI déjà décodée ou séquence invalide : on garde la valeur brute.
  }
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '';
}

// Préfixe du stockage interne Android : sans valeur pour l'utilisateur, on le masque à l'affichage.
const STORAGE_PREFIX = /^\/storage\/emulated\/\d+\//;

/**
 * Nom lisible d'un dossier : on retire le préfixe `/storage/emulated/0/`.
 * `/storage/emulated/0/Music/Rock` → `Music/Rock`. Un dossier vide ou racine renvoie « Racine ».
 */
export function displayFolder(path: string): string {
  if (!path) {
    return 'Racine';
  }
  const trimmed = path.replace(STORAGE_PREFIX, '').replace(/^\/+|\/+$/g, '');
  return trimmed.length > 0 ? trimmed : 'Racine';
}

// Segments de dossiers qui ne contiennent presque jamais de musique qu'on veut écouter.
const NON_MUSIC_SEGMENT = /(?:^|\/)(ringtones?|notifications?|alarms?|ui|sounds?)(?:\/|$)/i;

/**
 * Un dossier doit-il être exclu du scan par défaut ?
 *
 * Vrai pour les dossiers systèmes de sons (sonneries, notifications, alarmes) et pour les sons
 * propres aux applications (`Android/media/com.slack…`). Sert uniquement de *défaut* au premier
 * passage : l'utilisateur peut toujours réinclure un dossier, son choix est mémorisé ensuite.
 */
export function isAutoExcluded(path: string): boolean {
  if (/\/Android\/(media|data)\//i.test(path)) {
    return true;
  }
  return NON_MUSIC_SEGMENT.test(path);
}
