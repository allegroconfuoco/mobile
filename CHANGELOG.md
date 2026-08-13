# Changelog

Toutes les modifications notables de **Fuoco** sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

## [2.3.0] - 2026-08-13

### Added

- Nouvel accueil : une grille de 6 accès rapides (Reprendre, Favoris, En boucle, Top de l'année, puis les playlists les plus récemment modifiées). Le corps de la tuile ouvre la destination, le bouton lecture la joue directement.
- Menu latéral à la place de la barre d'onglets : il regroupe Accueil, Morceaux, Artistes, Albums, Playlists, Favoris, Écoutes et Réglages. Il s'ouvre par le bouton hamburger ou par un glissement depuis le bord gauche de l'écran.
- Glisser une ligne de morceau vers la droite l'ajoute à « Lire ensuite ».
- Bouton d'ajout rapide à droite de chaque morceau : un appui l'ajoute aux favoris, un second ouvre le choix des playlists, un appui long le retire des favoris.
- La sélection multiple est disponible sur tous les écrans de morceaux (artiste, album, playlist, favoris) et plus seulement dans la vue Morceaux. Elle propose six actions groupées : Playlist, Lire ensuite, File d'attente, Favoris, Exclure et Supprimer du téléphone.
- Bouton pour supprimer du téléphone tous les titres exclus d'un coup (Réglages > Bibliothèque), avec un seul dialogue de confirmation du système.
- « Reprendre » restaure maintenant toute la file d'attente, et plus seulement le morceau interrompu : fermer l'application ne fait plus perdre la liste en cours. Les fichiers entre-temps supprimés sont simplement sautés.
- Bandeau d'information sur l'accueil quand l'application n'arrive pas à joindre le serveur, pour distinguer une synchronisation en retard d'un vrai problème.
- Raccourcis recherche et réglages directement dans l'en-tête de l'accueil, la recherche s'ouvrant clavier déployé.
- Icône monochrome pour les icônes thématisées d'Android 13+.

### Changed

- L'APK passe d'environ 100 Mo à 19,7 Mo : une seule architecture processeur au lieu de quatre (les trois autres ne servaient qu'aux émulateurs et aux téléphones d'avant 2016), minification activée, dépendances et polices inutilisées retirées.
- Le bouton de tri ouvre une feuille de choix au lieu de faire défiler les critères un par un : n'importe quel tri est atteignable en un appui.
- La rangée « Récemment ajoutés » de l'accueil met toute la rangée en file d'attente au lieu du seul titre choisi.
- Le mini-lecteur reste affiché en bas de tous les écrans, y compris ceux qui n'étaient pas des onglets auparavant.
- La durée d'un morceau s'affiche en fin de sous-titre (« artiste · album · 3:42 ») pour libérer la place du bouton d'ajout rapide.
- La session reste valide plus longtemps côté serveur, ce qui réduit fortement le nombre de renouvellements de connexion.

### Fixed

- Plus de déconnexions intempestives : une coupure réseau au mauvais moment effaçait la session alors que celle-ci restait valide. L'application s'ouvre désormais sur la bibliothèque locale même en mode avion, au lieu de l'écran de connexion.
- Le tri « Ajouts récents » affichait en réalité l'ordre alphabétique. La date d'ajout est maintenant enregistrée par l'application elle-même, et elle est préservée quand un fichier est renommé ou re-tagué.
- L'icône de l'application s'affichait sur une tuile noire au lieu d'un simple médaillon, et se faisait rogner par les masques circulaires de certains lanceurs.
- Les derniers morceaux mis en favori remontent bien en tête de la liste des favoris.

### Removed

- La reprise de lecture d'un appareil à l'autre est retirée. La synchronisation des playlists et de l'historique d'écoute entre appareils, elle, reste en place.

## [2.2.0] - 2026-07-14

### Added

- Bouton favori (cœur) directement dans le mini-lecteur, sans avoir à ouvrir l'écran Lecture.
- Nouvelle action « Supprimer du téléphone » sur un morceau (doublons, titres qu'on n'aime pas) : passe par le dialogue de confirmation du système Android.

### Changed

- La revue avant gravure des tags (en lot) affiche désormais un résumé des champs qui vont changer sur chaque carte repliée, pour ne déplier que les morceaux qui demandent une vérification.
- Les morceaux avec plusieurs artistes (ex. « Fred again.. & Baby Keem ») sont désormais rattachés à l'artiste principal dans la vue Artistes, au lieu de former une entrée séparée.

### Fixed

- Le raccourci « Tout mettre en MusicBrainz » de la revue avant gravure applique maintenant aussi la pochette proposée (elle restait inchangée auparavant).
- Amélioration de la fiabilité du bouton « titre suivant » dans la notification et sur l'écran verrouillé.

## [2.1.0] - 2026-07-14

### Added

- Nouvel outil « Associer les artistes inconnus » (Réglages > Métadonnées & fichiers, et depuis la page d'un artiste inconnu) : passe en revue les titres sans artiste un par un, avec des propositions MusicBrainz classées par popularité et un geste de swipe pour valider ou passer au suivant. Le fichier en cours peut être écouté directement depuis l'écran.

### Changed

- Les recherches MusicBrainz par titre seul (utilisées par la nouvelle revue) sont désormais classées par popularité réelle de l'artiste plutôt que par ordre aléatoire, pour proposer l'artiste le plus probable en premier.

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

[Unreleased]: https://github.com/allegroconfuoco/mobile/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/allegroconfuoco/mobile/releases/tag/v2.3.0
[2.2.0]: https://github.com/allegroconfuoco/mobile/releases/tag/v2.2.0
[2.1.0]: https://github.com/allegroconfuoco/mobile/releases/tag/v2.1.0
[2.0.0]: https://github.com/allegroconfuoco/mobile/releases/tag/v2.0.0
[1.0.0]: https://github.com/allegroconfuoco/mobile/releases/tag/v1.0.0
