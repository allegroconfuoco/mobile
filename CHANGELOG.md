# Changelog

Toutes les modifications notables de **Fuoco** sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

## [2.0.0] - 2026-07-13

### Added

- Sélection multiple dans la bibliothèque (« Sélectionner » depuis le menu d'un morceau) pour ajouter plusieurs titres à une playlist, les lire ensuite ou les mettre en file d'un coup.
- Ajout de plusieurs titres à la fois à une playlist, y compris directement depuis l'écran de la playlist (recherche + sélection).

### Changed

- L'application répond plus vite dans l'ensemble : changement d'onglet instantané, moins de ralentissements pendant la lecture, tableau de bord des écoutes affiché sans délai.
- En-tête des playlists harmonisé avec celui des albums/artistes ; le menu d'actions sur un morceau est réorganisé (actions courantes d'abord, options avancées dans un sous-menu « Métadonnées »).
- Le réglage « Écoute privée » a déménagé des Écoutes vers les Réglages (Confidentialité).
- Tirer pour rafraîchir relance maintenant à la fois le scan de la bibliothèque et la synchronisation, sur tous les écrans concernés.
- Un appui long sur le mini-lecteur ouvre directement la file d'attente.
- Le bac « Album inconnu » propose désormais un bouton clair pour ranger ses titres via MusicBrainz.

### Fixed

- Réordonner une playlist ou la file d'attente ne fait plus brièvement « sauter » la liste à l'ancien ordre après le lâcher.

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

[Unreleased]: https://github.com/allegroconfuoco/mobile/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/allegroconfuoco/mobile/releases/tag/v2.0.0
[1.0.0]: https://github.com/allegroconfuoco/mobile/releases/tag/v1.0.0
