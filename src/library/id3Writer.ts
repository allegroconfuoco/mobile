/**
 * Writer de tags ID3 — pur JS, pendant en écriture de `./id3` (lecture seule).
 *
 * Grave un tag **ID3v2.3** en tête de fichier. Choix de la v2.3 (et non v2.4) pour la
 * **compatibilité** : c'est la version que lisent le plus largement les scanners Android/MediaStore,
 * autoradios et lecteurs tiers ; notre propre parser (`./id3`) lit de toute façon 2.2/2.3/2.4, donc
 * un round-trip write→read reste exact. Encodage texte choisi par champ : ISO-8859-1 (encodage 0)
 * quand le texte tient en latin1 (cas majoritaire, tag le plus compact), sinon UTF-16LE+BOM
 * (encodage 1). Tailles de frame en entier plat 32 bits (spec v2.3) ; taille du tag global en
 * synchsafe (commune à toutes les versions). Pas de désynchronisation, pas d'en-tête étendu.
 *
 * Ne gère que ce que le reader gère (MP3/ID3) : titre/artiste/album/album-artist/n° piste/n° disque
 * + une pochette front (APIC). Pas de FLAC/M4A (hors périmètre, cf. `./id3`).
 */
import { hasId3v2, id3v2BodySize } from './id3';

/** Une pochette à embarquer dans une frame APIC. */
export type WritablePicture = {
  /** Type MIME, ex. `image/jpeg`. */
  mime: string;
  /** Octets bruts de l'image. */
  data: Uint8Array;
};

/** Champs à graver. Un champ absent (`undefined`/`null`) n'écrit pas la frame correspondante. */
export type WritableTags = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  trackNo?: number | null;
  discNo?: number | null;
  picture?: WritablePicture | null;
};

// --- Encodage bas niveau ---------------------------------------------------------------------

/** Entier 32 bits big-endian « plat » (tailles de frame ID3v2.3). */
function uint32BE(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/** Entier « synchsafe » 28 bits (taille du tag global, 4 octets à 7 bits utiles). */
function synchsafe(n: number): Uint8Array {
  return new Uint8Array([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]);
}

/** Vrai si toute la chaîne tient en ISO-8859-1 (points de code < 256). */
function isLatin1(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xff) {
      return false;
    }
  }
  return true;
}

function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/** UTF-16LE avec BOM en tête (les unités JS sont déjà de l'UTF-16). */
function encodeUtf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff; // BOM little-endian
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out[2 + i * 2] = unit & 0xff;
    out[2 + i * 2 + 1] = (unit >> 8) & 0xff;
  }
  return out;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) {
    total += c.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// --- Frames ----------------------------------------------------------------------------------

/** En-tête de frame v2.3 : id (4) + taille plate (4) + flags (2, nuls). */
function frameHeader(id: string, dataSize: number): Uint8Array {
  return concat([encodeLatin1(id), uint32BE(dataSize), new Uint8Array([0x00, 0x00])]);
}

/**
 * Frame texte (TIT2/TPE1/…). Corps = [octet d'encodage][texte][terminateur].
 * Latin1 si possible (plus compact), sinon UTF-16LE+BOM. Terminateur NUL inclus (1 ou 2 octets)
 * pour les lecteurs stricts ; notre parser coupe de toute façon au premier NUL.
 */
function textFrame(id: string, text: string): Uint8Array {
  let body: Uint8Array;
  if (isLatin1(text)) {
    body = concat([new Uint8Array([0x00]), encodeLatin1(text), new Uint8Array([0x00])]);
  } else {
    body = concat([new Uint8Array([0x01]), encodeUtf16le(text), new Uint8Array([0x00, 0x00])]);
  }
  return concat([frameHeader(id, body.length), body]);
}

/**
 * Frame APIC (pochette). Encodage latin1 pour le MIME/description, type 0x03 (front cover),
 * description vide. Corps = [0x00][mime][0x00][0x03][0x00][octets image].
 */
function pictureFrame(picture: WritablePicture): Uint8Array {
  const mime = picture.mime || 'image/jpeg';
  const body = concat([
    new Uint8Array([0x00]), // encodage texte (latin1) du MIME/description
    encodeLatin1(mime),
    new Uint8Array([0x00]), // fin du MIME
    new Uint8Array([0x03]), // type d'image : front cover
    new Uint8Array([0x00]), // description vide (terminateur)
    picture.data,
  ]);
  return concat([frameHeader('APIC', body.length), body]);
}

// --- Tag complet -----------------------------------------------------------------------------

/** Ajoute une frame texte au lot si la valeur est non vide. */
function pushText(frames: Uint8Array[], id: string, value: string | null | undefined): void {
  const text = value?.trim();
  if (text) {
    frames.push(textFrame(id, text));
  }
}

/**
 * Sérialise un tag ID3v2.3 complet à partir des champs fournis. Seules les frames dont la valeur
 * est présente sont écrites (un tag « propre » ne porte pas de champs vides).
 */
export function buildId3v2(tags: WritableTags): Uint8Array {
  const frames: Uint8Array[] = [];
  pushText(frames, 'TIT2', tags.title);
  pushText(frames, 'TPE1', tags.artist);
  pushText(frames, 'TALB', tags.album);
  pushText(frames, 'TPE2', tags.albumArtist);
  pushText(frames, 'TRCK', tags.trackNo != null ? String(tags.trackNo) : null);
  pushText(frames, 'TPOS', tags.discNo != null ? String(tags.discNo) : null);
  if (tags.picture && tags.picture.data.length > 0) {
    frames.push(pictureFrame(tags.picture));
  }

  const body = concat(frames);
  const header = concat([
    encodeLatin1('ID3'),
    new Uint8Array([0x03, 0x00]), // version 2.3.0
    new Uint8Array([0x00]), // flags
    synchsafe(body.length),
  ]);
  return concat([header, body]);
}

// --- Remplacement dans un fichier ------------------------------------------------------------

/** Vrai si les 128 derniers octets forment un bloc ID3v1 (« TAG »). */
function hasTrailingId3v1(data: Uint8Array): boolean {
  if (data.length < 128) {
    return false;
  }
  const s = data.length - 128;
  return data[s] === 0x54 && data[s + 1] === 0x41 && data[s + 2] === 0x47; // "TAG"
}

/**
 * Remplace le tag ID3 en tête de `original` par `newTag`, en conservant l'audio intact.
 *
 * - Si `original` porte déjà un tag ID3v2, il est retiré (on saute son en-tête + son corps).
 * - Un éventuel bloc ID3v1 en fin de fichier est **supprimé** : le tag v2.3 écrit le remplace, et
 *   le laisser afficherait d'anciennes valeurs dans les lecteurs qui préfèrent le v1.
 *
 * Retourne les octets complets du nouveau fichier (tag + audio).
 */
export function replaceId3(original: Uint8Array, newTag: Uint8Array): Uint8Array {
  let audioStart = 0;
  if (hasId3v2(original.subarray(0, Math.min(10, original.length)))) {
    audioStart = 10 + id3v2BodySize(original.subarray(0, 10));
    if (audioStart > original.length) {
      audioStart = original.length; // tag corrompu annonçant une taille aberrante : on se protège
    }
  }
  const audioEnd = hasTrailingId3v1(original) ? original.length - 128 : original.length;
  const audio = original.subarray(audioStart, Math.max(audioStart, audioEnd));
  return concat([newTag, audio]);
}
