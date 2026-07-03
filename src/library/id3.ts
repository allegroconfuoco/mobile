/**
 * Parser de tags ID3 — pur JS, sans dépendance native.
 *
 * Beaucoup de fichiers téléchargés ont des tags absents ou pourris (cf. `PROJET.md`,
 * enjeu « qualité des métadonnées »). Ce module lit ce qu'il peut et ne jette jamais :
 * un tag illisible retourne simplement des champs vides, jamais une exception.
 *
 * Couvre :
 * - ID3v2.2 (frames 3 caractères : TT2/TP1/TAL/PIC)
 * - ID3v2.3 et ID3v2.4 (frames 4 caractères : TIT2/TPE1/TALB/APIC)
 * - ID3v1 (128 octets en fin de fichier) en repli
 * - désynchronisation (globale et par frame en 2.4), en-tête étendu, indicateur de taille de données
 * - encodages texte : ISO-8859-1 (0), UTF-16+BOM (1), UTF-16BE (2), UTF-8 (3)
 *
 * Ce qu'on ne fait pas : lyrics, commentaires, tags Vorbis/MP4 (FLAC/M4A). Le repli
 * « nom de fichier » côté UI couvre ces formats en attendant le niveau 2 (AcoustID).
 */

/** Image de pochette extraite d'un tag (frame APIC/PIC). */
export type Picture = {
  /** Type MIME, ex. `image/jpeg`. */
  mime: string;
  /** Octets bruts de l'image (JPEG/PNG le plus souvent). */
  data: Uint8Array;
};

/** Tags lus dans un fichier. Chaque champ est absent s'il n'a pas pu être lu. */
export type ParsedTags = {
  title?: string;
  artist?: string;
  album?: string;
  /** Artiste de l'album (TPE2) : sert à regrouper les compilations sous un même artiste. */
  albumArtist?: string;
  /** Numéro de piste (TRCK), pour ordonner les pistes d'un album. */
  trackNo?: number;
  picture?: Picture;
};

// --- Décodeurs de texte (pas de dépendance à TextDecoder, absent/incomplet sous Hermes) ---

function decodeLatin1(b: Uint8Array, start = 0, end = b.length): string {
  let s = '';
  for (let i = start; i < end; i++) {
    s += String.fromCharCode(b[i]);
  }
  return s;
}

function decodeUtf8(b: Uint8Array, start: number, end: number): string {
  let s = '';
  let i = start;
  while (i < end) {
    const c = b[i++];
    if (c < 0x80) {
      s += String.fromCharCode(c);
    } else if (c < 0xe0) {
      s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    } else if (c < 0xf0) {
      const c2 = b[i++];
      const c3 = b[i++];
      s += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
    } else {
      const c2 = b[i++];
      const c3 = b[i++];
      const c4 = b[i++];
      let cp = ((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f);
      cp -= 0x10000;
      // Paire de substitution (surrogate pair) UTF-16.
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return s;
}

function decodeUtf16(b: Uint8Array, start: number, end: number, bigEndian: boolean): string {
  let s = '';
  // On passe les unités 16 bits telles quelles : une string JS est déjà de l'UTF-16,
  // donc les paires de substitution se reconstituent automatiquement.
  for (let i = start; i + 1 < end; i += 2) {
    const unit = bigEndian ? (b[i] << 8) | b[i + 1] : (b[i + 1] << 8) | b[i];
    s += String.fromCharCode(unit);
  }
  return s;
}

/**
 * Décode un champ texte de frame selon son octet d'encodage.
 * `body` commence à l'octet d'encodage (donc `body[0]` = encodage, reste = texte).
 */
function decodeTextField(body: Uint8Array): string {
  const encoding = body[0];
  let start = 1;
  let end = body.length;
  let value: string;
  switch (encoding) {
    case 1: {
      // UTF-16 avec BOM.
      let bigEndian = false;
      if (end - start >= 2) {
        if (body[start] === 0xfe && body[start + 1] === 0xff) {
          bigEndian = true;
          start += 2;
        } else if (body[start] === 0xff && body[start + 1] === 0xfe) {
          start += 2;
        }
      }
      value = decodeUtf16(body, start, end, bigEndian);
      break;
    }
    case 2:
      // UTF-16BE sans BOM (ID3v2.4).
      value = decodeUtf16(body, start, end, true);
      break;
    case 3:
      value = decodeUtf8(body, start, end);
      break;
    default:
      // 0 = ISO-8859-1, et repli pour tout octet d'encodage inconnu.
      value = decodeLatin1(body, start, end);
      break;
  }
  return cleanText(value);
}

/** Coupe au premier séparateur NUL (multi-valeur ID3) et nettoie les bords. */
function cleanText(value: string): string {
  const nul = value.indexOf('\u0000');
  const first = nul >= 0 ? value.slice(0, nul) : value;
  return first.replace(/\uFEFF/g, '').trim();
}

// --- Entiers ---

/** Entier « synchsafe » 28 bits (4 octets à 7 bits utiles). */
function syncsafe(b: Uint8Array, i: number): number {
  return (
    ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)
  );
}

/** Entier 32 bits big-endian « plat » (tailles de frame ID3v2.3). */
function uint32(b: Uint8Array, i: number): number {
  return b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
}

/**
 * Inverse la désynchronisation : toute séquence `0xFF 0x00` redevient `0xFF`.
 * Rare en pratique, mais requis pour ne pas décaler tout le parsing quand présent.
 */
function deunsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) {
      i++;
    }
  }
  return out.subarray(0, n);
}

// --- Recherche de terminateur (pour mime + description dans APIC/PIC) ---

/** Position du terminateur NUL (1 octet, ou 2 octets alignés pour l'UTF-16). */
function findTerminator(b: Uint8Array, start: number, end: number, wide: boolean): number {
  if (wide) {
    for (let i = start; i + 1 < end; i += 2) {
      if (b[i] === 0 && b[i + 1] === 0) {
        return i;
      }
    }
  } else {
    for (let i = start; i < end; i++) {
      if (b[i] === 0) {
        return i;
      }
    }
  }
  return end;
}

// --- Frames image ---

/** Parse une frame APIC (ID3v2.3/2.4). Retourne `undefined` si ce n'est pas une image. */
function parseApic(data: Uint8Array): { picture: Picture; isFront: boolean } | undefined {
  if (data.length < 4) {
    return undefined;
  }
  const encoding = data[0];
  const wide = encoding === 1 || encoding === 2;
  const mimeEnd = findTerminator(data, 1, data.length, false);
  const mime = decodeLatin1(data, 1, mimeEnd).trim();
  // Type `-->` = lien externe, pas des octets d'image : on l'ignore.
  if (mime === '-->') {
    return undefined;
  }
  let p = mimeEnd + 1;
  if (p >= data.length) {
    return undefined;
  }
  const pictureType = data[p];
  p += 1;
  const descEnd = findTerminator(data, p, data.length, wide);
  p = descEnd + (wide ? 2 : 1);
  if (p >= data.length) {
    return undefined;
  }
  return {
    picture: { mime: mime || 'image/jpeg', data: data.slice(p) },
    isFront: pictureType === 0x03,
  };
}

/** Parse une frame PIC (ID3v2.2). Le format d'image est un code 3 lettres (`JPG`/`PNG`). */
function parsePic(data: Uint8Array): { picture: Picture; isFront: boolean } | undefined {
  if (data.length < 5) {
    return undefined;
  }
  const encoding = data[0];
  const wide = encoding === 1 || encoding === 2;
  const format = decodeLatin1(data, 1, 4).toUpperCase();
  let p = 4;
  const pictureType = data[p];
  p += 1;
  const descEnd = findTerminator(data, p, data.length, wide);
  p = descEnd + (wide ? 2 : 1);
  if (p >= data.length) {
    return undefined;
  }
  const mime = format === 'PNG' ? 'image/png' : 'image/jpeg';
  return {
    picture: { mime, data: data.slice(p) },
    isFront: pictureType === 0x03,
  };
}

// --- ID3v2 ---

/** Vrai si `header` (≥ 3 octets) commence par la signature `ID3`. */
export function hasId3v2(header: Uint8Array): boolean {
  return header.length >= 3 && header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33;
}

/**
 * Taille du corps du tag ID3v2 (hors en-tête de 10 octets), lue dans l'en-tête.
 * Suppose `hasId3v2(header)` déjà vérifié.
 */
export function id3v2BodySize(header: Uint8Array): number {
  return syncsafe(header, 6);
}

/**
 * Parse un tag ID3v2 à partir de son en-tête (10 octets) et de son corps.
 * `header` et `body` proviennent de deux lectures successives du début de fichier.
 */
export function parseId3v2(header: Uint8Array, body: Uint8Array): ParsedTags {
  const tags: ParsedTags = {};
  const versionMajor = header[3];
  const flags = header[5];

  // Désynchronisation globale (2.2/2.3) : on nettoie tout le corps avant de découper.
  let buf = flags & 0x80 ? deunsync(body) : body;

  const v22 = versionMajor === 2;
  const idLen = v22 ? 3 : 4;
  const headerLen = v22 ? 6 : 10;

  let offset = 0;

  // En-tête étendu optionnel : on le saute pour tomber sur la première frame.
  if (flags & 0x40) {
    if (versionMajor === 4) {
      offset += syncsafe(buf, 0); // taille synchsafe, s'inclut elle-même
    } else if (versionMajor === 3) {
      offset += 4 + uint32(buf, 0); // taille plate, hors les 4 octets de taille
    }
  }

  // Une pochette front l'emporte sur toute autre image ; sinon on garde la première vue.
  let pictureIsFront = false;

  while (offset + headerLen <= buf.length) {
    // Octet nul = début du padding : plus de frames.
    if (buf[offset] === 0) {
      break;
    }
    const id = decodeLatin1(buf, offset, offset + idLen);
    // Un identifiant non alphanumérique = tag corrompu ou fin réelle : on s'arrête.
    if (!/^[A-Z0-9]+$/.test(id)) {
      break;
    }

    let size: number;
    if (v22) {
      size = (buf[offset + 3] << 16) | (buf[offset + 4] << 8) | buf[offset + 5];
    } else if (versionMajor === 4) {
      size = syncsafe(buf, offset + 4);
    } else {
      size = uint32(buf, offset + 4);
    }

    const frameFlags = v22 ? 0 : buf[offset + 9];
    const dataStart = offset + headerLen;
    if (size <= 0 || dataStart + size > buf.length) {
      break;
    }

    let data = buf.subarray(dataStart, dataStart + size);

    // Spécificités ID3v2.4 par frame.
    if (versionMajor === 4) {
      if (frameFlags & 0x01) {
        // Indicateur de taille de données : 4 octets synchsafe en tête, à ignorer.
        data = data.subarray(4);
      }
      if (frameFlags & 0x02) {
        data = deunsync(data);
      }
    }

    switch (id) {
      case 'TIT2':
      case 'TT2':
        if (!tags.title) tags.title = orUndefined(decodeTextField(data));
        break;
      case 'TPE1':
      case 'TP1':
        if (!tags.artist) tags.artist = orUndefined(decodeTextField(data));
        break;
      case 'TALB':
      case 'TAL':
        if (!tags.album) tags.album = orUndefined(decodeTextField(data));
        break;
      case 'TPE2':
      case 'TP2':
        if (!tags.albumArtist) tags.albumArtist = orUndefined(decodeTextField(data));
        break;
      case 'TRCK':
      case 'TRK':
        if (tags.trackNo == null) tags.trackNo = parseTrackNo(decodeTextField(data));
        break;
      case 'APIC':
      case 'PIC': {
        if (!pictureIsFront) {
          const parsed = id === 'PIC' ? parsePic(data) : parseApic(data);
          if (parsed && parsed.picture.data.length > 0) {
            tags.picture = parsed.picture;
            pictureIsFront = parsed.isFront;
          }
        }
        break;
      }
    }

    offset = dataStart + size;
  }

  return tags;
}

// --- ID3v1 (repli) ---

/**
 * Parse un bloc ID3v1 (128 octets) : signature `TAG` + champs à taille fixe.
 * Encodage ISO-8859-1 uniquement (spec ID3v1). Retourne `null` si pas de tag.
 */
export function parseId3v1(block: Uint8Array): ParsedTags | null {
  if (block.length < 128) {
    return null;
  }
  const start = block.length - 128;
  if (block[start] !== 0x54 || block[start + 1] !== 0x41 || block[start + 2] !== 0x47) {
    return null; // pas "TAG"
  }
  const field = (from: number, len: number) =>
    cleanFixed(decodeLatin1(block, start + from, start + from + len));
  return {
    title: orUndefined(field(3, 30)),
    artist: orUndefined(field(33, 30)),
    album: orUndefined(field(63, 30)),
  };
}

/** Nettoie un champ ID3v1 à taille fixe (bourré d'espaces et/ou de NUL). */
function cleanFixed(value: string): string {
  const nul = value.indexOf('\u0000');
  return (nul >= 0 ? value.slice(0, nul) : value).trim();
}

function orUndefined(value: string): string | undefined {
  return value.length > 0 ? value : undefined;
}

/** Extrait le numéro de piste d'un champ TRCK (« 3 » ou « 3/12 »), ou `undefined`. */
function parseTrackNo(value: string): number | undefined {
  const match = value.match(/\d+/);
  if (!match) {
    return undefined;
  }
  const n = parseInt(match[0], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Fusionne deux jeux de tags : `primary` gagne, `fallback` comble les trous. */
export function mergeTags(primary: ParsedTags | null, fallback: ParsedTags | null): ParsedTags {
  return {
    title: primary?.title ?? fallback?.title,
    artist: primary?.artist ?? fallback?.artist,
    album: primary?.album ?? fallback?.album,
    albumArtist: primary?.albumArtist ?? fallback?.albumArtist,
    trackNo: primary?.trackNo ?? fallback?.trackNo,
    picture: primary?.picture ?? fallback?.picture,
  };
}
