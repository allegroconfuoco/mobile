@AGENTS.md

## Journal des évolutions

Après chaque évolution mobile, ajouter ici une entrée de 2 phrases (quoi + où), la plus récente en haut, pour garder le suivi d'une conversation à l'autre.

- **Issue #4 — Permission audio + scan bibliothèque locale** (2026-07-02) : ajout de `expo-media-library` (plugin `app.json` limité à `READ_MEDIA_AUDIO` via `granularPermissions: ['audio']`) et d'un hook `src/library/useAudioLibrary.ts` qui demande la permission puis scanne l'audio du media store (`Query.exeForMetadata`, API « Next »). L'écran Bibliothèque (`app/(tabs)/index.tsx`) gère tous les états (loading/scanning/undetermined/denied/vide/liste) et affiche les titres détectés ; lint, format, typecheck et export web OK.
- **Issue #3 — Qualité mobile (Prettier + CI)** (2026-07-02) : ajout de Prettier (`.prettierrc.json`, `.prettierignore`, `eslint-config-prettier` dans `eslint.config.js`, scripts `format`/`format:check`) et d'un workflow `.github/workflows/ci.yml` (job quality lint+format+typecheck, job build Android via `expo prebuild` + `gradlew assembleDebug` sous JDK 21). Ajout d'un `exclude` dans `tsconfig.json` (example/android/ios/dist).
- **Issue #2 — Navigation + thème de base** (2026-07-02) : mis en place le thème Direction B « Forge » (tokens dans `src/theme/`, icônes Material Symbols par ligature via `src/components/Icon.tsx`, police Schibsted Grotesk) et la navigation (Tabs Bibliothèque/Réglages via `expo-router/js-tabs` + tab bar custom `ForgeTabBar`, écran Lecture en modal). Trois écrans placeholder créés (`app/(tabs)/index.tsx`, `app/(tabs)/settings.tsx`, `app/now-playing.tsx`) ; typecheck, lint et export web OK.
