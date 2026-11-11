import { useEffect } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';

import { colors } from '@/theme';
import { MiniPlayer } from '@/components/MiniPlayer';
import { TabBar } from '@/components/TabBar';
import { reportBottomChromeHeight } from '@/lib/bottomChrome';
import { getTab, setTab } from '@/lib/tabs';

// Ancre de la pile : l'écran des onglets est toujours dessous. Un écran de détail ouvert à froid
// retrouve donc un « retour » cohérent.
export const unstable_settings = { initialRouteName: 'index' };

/**
 * Coquille de l'app (post-connexion).
 *
 * Un **Stack unique et à plat** : sa racine (`index`) porte les quatre onglets comme de simples
 * panneaux, et les écrans de détail (artiste, album, playlist, recherche, réglages…) se poussent
 * par-dessus. Sous le Stack, un « chrome » bas **persistant** : le mini-lecteur puis la barre
 * d'onglets, visibles partout — y compris sur les écrans de détail.
 *
 * Pas de navigateur à onglets, donc pas de piles imbriquées : le retour Android n'a qu'une pile à
 * dépiler, et changer d'onglet ne monte ni ne démonte aucun écran.
 */
export default function AppLayout() {
  const insets = useSafeAreaInsets();

  // Bouton retour matériel Android : dépiler l'écran de détail s'il y en a un ; sinon revenir au
  // premier onglet ; sinon laisser le système quitter l'app.
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canDismiss()) {
        router.back();
        return true;
      }
      if (getTab() !== 'tracks') {
        setTab('tracks');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          // Un même mouvement pour tous les écrans de détail : ils arrivent par la droite et
          // repartent par où ils sont venus.
          animation: 'ios_from_right',
        }}
      >
        <Stack.Screen name="index" />
        {/* La recherche n'est pas « plus loin » dans une hiérarchie : elle se pose sur place. */}
        <Stack.Screen name="(library)/search" options={{ animation: 'fade' }} />
      </Stack>
      {/* Chrome bas persistant. Sa hauteur mesurée positionne le toast (cf. bottomChrome). */}
      <View
        style={{ backgroundColor: colors.surfaceNav, paddingBottom: insets.bottom }}
        onLayout={(e) => reportBottomChromeHeight(e.nativeEvent.layout.height)}
      >
        <MiniPlayer />
        <TabBar />
      </View>
    </View>
  );
}
