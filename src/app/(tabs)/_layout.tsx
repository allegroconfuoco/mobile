import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { ForgeTabBar } from '@/components/ForgeTabBar';

export default function TabsLayout() {
  // Bouton retour matériel Android : le TabRouter de js-tabs (backBehavior `firstRoute`, historique
  // d'onglets) consomme le GO_BACK AVANT que le stack de l'onglet ne dépile — depuis un sous-écran
  // des Réglages, « retour » ramenait à la bibliothèque au lieu de l'écran Réglages (bug expo-router
  // connu, cf. expo/expo#33489). On intercepte donc le retour matériel : si un stack de la branche
  // focalisée peut dépiler (`canDismiss`, sous-écran ou modal ouvert), on dépile nous-mêmes via
  // `router.back()` (le chemin du bouton retour de l'app, qui fonctionne) ; sinon on laisse le
  // comportement par défaut (retour à l'onglet Biblio, puis sortie de l'app).
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canDismiss()) {
        router.back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  return (
    // `freezeOnBlur` (forwardé à react-native-screens / react-freeze) : les onglets non focalisés
    // ne re-rendent plus du tout — état et pile conservés, `useFocusEffect` refire bien au retour.
    // Le layout lui-même (donc le BackHandler ci-dessus) n'est jamais gelé, seul le contenu l'est.
    <Tabs
      screenOptions={{ headerShown: false, freezeOnBlur: true }}
      tabBar={(props) => <ForgeTabBar {...props} />}
    >
      {/* Chaque onglet est un Stack (groupe entre parenthèses, invisible dans l'URL) : les écrans de
          détail y sont poussés en gardant la tab bar + le mini-player visibles. */}
      <Tabs.Screen name="(library)" options={{ title: 'Biblio' }} />
      <Tabs.Screen name="(stats)" options={{ title: 'Écoutes' }} />
      <Tabs.Screen name="(settings)" options={{ title: 'Réglages' }} />
    </Tabs>
  );
}
