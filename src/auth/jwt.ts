/**
 * Lecture *sans vérification* du payload d'un JWT, côté client.
 *
 * On ne valide PAS la signature ici (c'est le rôle du backend) : on lit juste `exp` pour savoir
 * si l'access token est périmé et décider d'un refresh proactif. Toute erreur de décodage renvoie
 * `null` → traité comme « expiration inconnue », donc on tentera un refresh plutôt que de faire
 * confiance à un token illisible.
 */

/** Décode une chaîne base64url (JWT) en texte UTF-8, ou `null` si invalide. */
function decodeBase64Url(segment: string): string | null {
  try {
    // base64url → base64 standard, puis padding.
    let base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    // atob est fourni par Hermes (RN ≥ 0.74) ; on repasse les octets en UTF-8.
    const binary = atob(base64);
    const utf8 = decodeURIComponent(
      binary
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    return utf8;
  } catch {
    return null;
  }
}

/**
 * Extrait la date d'expiration (`exp`, en **millisecondes**) d'un JWT, ou `null` si absente/illisible.
 * `exp` est stocké en secondes epoch dans le token ; on le convertit en ms pour comparer à `Date.now()`.
 */
export function getTokenExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const payloadJson = decodeBase64Url(parts[1]);
  if (!payloadJson) {
    return null;
  }
  try {
    const payload = JSON.parse(payloadJson) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Extrait l'identité de l'utilisateur du payload d'un JWT, ou `null` si illisible.
 *
 * Le backend expose l'UUID comme identifiant (`getUserIdentifier()` renvoie l'UUID) ; selon la
 * config lexik ce claim peut s'appeler `sub`, `username` ou `id` — on les essaie dans cet ordre.
 * Sert au moteur de synchro à détecter un changement de compte sur la base locale partagée.
 */
export function getTokenSubject(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const payloadJson = decodeBase64Url(parts[1]);
  if (!payloadJson) {
    return null;
  }
  try {
    const payload = JSON.parse(payloadJson) as { sub?: unknown; username?: unknown; id?: unknown };
    for (const claim of [payload.sub, payload.username, payload.id]) {
      if (typeof claim === 'string' && claim !== '') {
        return claim;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Vrai si le token est expiré ou le sera dans `skewMs` millisecondes (marge par défaut : 30 s,
 * pour ne pas partir avec un token qui périme en plein vol). Un `exp` illisible est considéré
 * comme expiré (prudent : on refreshera).
 */
export function isTokenExpired(token: string, skewMs = 30_000): boolean {
  const expiryMs = getTokenExpiryMs(token);
  if (expiryMs === null) {
    return true;
  }
  return Date.now() + skewMs >= expiryMs;
}
