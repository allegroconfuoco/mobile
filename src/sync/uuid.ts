/**
 * Génération d'UUIDv7 côté client (synchro playlists, issue #17).
 *
 * Le backend attend des identifiants **détenus par le client** (`Uuid::isValid` accepte tout UUID
 * RFC 4122, dont v7) : le même enregistrement garde une seule identité sur tous les appareils. On
 * choisit l'UUIDv7 (timestamp + aléatoire) plutôt que v4 pour que les ids restent ordonnés dans le
 * temps, ce qui aide les index et le tri.
 *
 * Aléa via `Math.random` : comme le `randomId` (v4) d'origine, l'usage n'est pas cryptographique
 * (le serveur arbitre l'identité et la propriété), donc pas de dépendance native ajoutée
 * (`expo-crypto.getRandomBytes` reste un remplaçant possible si on voulait plus de robustesse aux
 * collisions un jour). Fonctionne à l'identique sur web (aucun module natif).
 */

/** `count` chiffres hexadécimaux pseudo-aléatoires. */
function randomHex(count: number): string {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    out += ((Math.random() * 16) | 0).toString(16);
  }
  return out;
}

/**
 * Un UUIDv7 canonique `tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx` : 48 bits de timestamp ms
 * (big-endian), le nibble de version `7`, le variant `10` (donc `y` ∈ 8..b), le reste aléatoire.
 */
export function uuidv7(): string {
  // 48 bits de temps en 12 hex ; `Date.now()` (~11 hex aujourd'hui) est complété à gauche.
  const timeHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const timeHigh = timeHex.slice(0, 8);
  const timeMid = timeHex.slice(8, 12);
  // Variant RFC 4122 : les 2 bits de poids fort à `10` → premier nibble dans {8,9,a,b}.
  const variantNibble = (8 + ((Math.random() * 4) | 0)).toString(16);
  return `${timeHigh}-${timeMid}-7${randomHex(3)}-${variantNibble}${randomHex(3)}-${randomHex(12)}`;
}
