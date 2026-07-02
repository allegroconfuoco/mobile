@AGENTS.md

## Journal des évolutions

Après chaque évolution mobile, ajouter ici une entrée de 2 phrases (quoi + où), la plus récente en haut, pour garder le suivi d'une conversation à l'autre.

- **Issue #2 — Navigation + thème de base** (2026-07-02) : mis en place le thème Direction B « Forge » (tokens dans `src/theme/`, icônes Material Symbols par ligature via `src/components/Icon.tsx`, police Schibsted Grotesk) et la navigation (Tabs Bibliothèque/Réglages via `expo-router/js-tabs` + tab bar custom `ForgeTabBar`, écran Lecture en modal). Trois écrans placeholder créés (`app/(tabs)/index.tsx`, `app/(tabs)/settings.tsx`, `app/now-playing.tsx`) ; typecheck, lint et export web OK.
