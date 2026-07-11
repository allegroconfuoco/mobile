# Changelog

Toutes les modifications notables de **Fuoco** sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

## [1.0.0] - 2026-07-12

### Added

- **Lecture** : lecture locale en arrière-plan (notification, écran verrouillé), file d'attente réordonnable par glisser-déposer, lecture aléatoire, répétition (file/piste), minuteur de sommeil, reprise intelligente du morceau précédent.
- **Bibliothèque** : scan du stockage local (pistes/artistes/albums/playlists), tags ID3 + pochettes, recherche et tri, exclusion de dossiers ou fichiers individuels.
- **Playlists & favoris** : création/renommage/suppression/réordonnancement des playlists, favoris locaux.
- **Compte & synchronisation** : inscription/connexion, synchronisation multi-appareils des playlists et de l'historique d'écoute, reprise de lecture entre appareils.
- **Enrichissement MusicBrainz** : récupération automatique de pochettes/métadonnées, correction manuelle, identification d'album (ordre de pistes correct multi-disque, pistes manquantes affichées en fantôme).
- **Édition des fichiers** : gravure des métadonnées corrigées directement dans les MP3 (ID3, restaurable), outils d'édition en lot (associer un artiste, dissocier un album, nettoyer les titres).
- **Statistiques d'écoute** : tableau de bord (temps d'écoute, tops titres/artistes/albums, tendance, heatmap d'habitudes), badges, export des données, carte de partage.
- **Réglages** : vidage du cache, préférences de lecture, gestion du compte.
- **Distribution** : publication de l'APK signé sur les releases GitHub à chaque tag, vérification de version au lancement (mise à jour recommandée ou obligatoire selon la version installée).

[Unreleased]: https://github.com/allegroconfuoco/mobile/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/allegroconfuoco/mobile/releases/tag/v1.0.0
