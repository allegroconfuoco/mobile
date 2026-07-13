// Point d'entrée personnalisé.
//
// On garde l'entrée expo-router (routing par fichiers) et on y greffe le handler d'événements
// arrière-plan de @rntp/player. L'enregistrement vit dans un module à effet de bord importé
// AVANT expo-router/entry (les imports s'exécutent dans l'ordre de déclaration) : le handler
// headless est ainsi posé avant l'enregistrement du composant racine, comme la doc l'exige.
import './src/player/backgroundHandler';
import 'expo-router/entry';
