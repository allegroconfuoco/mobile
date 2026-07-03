// Point d'entrée personnalisé.
//
// On garde l'entrée expo-router (routing par fichiers) et on y greffe l'enregistrement du
// service de lecture react-native-track-player. `registerPlaybackService` doit être appelé au
// niveau module, le plus tôt possible, hors de tout composant : c'est la seule façon pour RNTP
// de reprendre la lecture quand l'app est en arrière-plan ou tuée.
import 'expo-router/entry';
import { Platform } from 'react-native';
import TrackPlayer from 'react-native-track-player';

import { PlaybackService } from './src/player/service';

// Pas de service natif sur le web (aucun lecteur en arrière-plan à piloter).
if (Platform.OS !== 'web') {
  TrackPlayer.registerPlaybackService(() => PlaybackService);
}
