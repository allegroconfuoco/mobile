// Stub web d'expo-sqlite.
//
// Fuoco est Android only (cf. PROJET.md) : la persistance locale de la bibliothèque n'a de sens
// que sur natif. La vraie implémentation web d'expo-sqlite importe un module `.wasm`
// (`wa-sqlite.wasm`) que Metro ne sait pas résoudre, ce qui casse `expo export --platform web`
// (notre check de bundle). Toute la couche `src/library/db.ts` est déjà gardée par
// `Platform.OS !== 'web'` : `openDatabaseSync` n'est jamais appelée sur le web, ce stub existe
// donc uniquement pour satisfaire l'import.
//
// Aliasé à la place du paquet npm sur le web via metro.config.js. Les types restent résolus
// depuis le vrai paquet (tsc n'utilise pas cet alias), donc l'API tapée reste juste.

export const openDatabaseSync = () => {
  throw new Error('expo-sqlite indisponible sur le web (Fuoco est Android only).');
};

export const openDatabaseAsync = openDatabaseSync;
