import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';

import { colors } from '@/theme';
import { MiniPlayer } from '@/components/MiniPlayer';
import { AppDrawer } from '@/components/AppDrawer';
import { subscribeOpenDrawer } from '@/lib/drawer';
import { reportBottomChromeHeight } from '@/lib/bottomChrome';

// Ancre de la pile : l'accueil (Dashboard) est le premier écran. Les détails (artiste, album,
// playlist, réglages…) et les listes (Morceaux, Artistes…) se poussent au-dessus, sous le
// mini-player persistant. Un deep link à froid monte donc l'accueil dessous → « retour » cohérent.
export const unstable_settings = { initialRouteName: 'index' };

/**
 * Coquille de l'app (post-connexion) : un Stack unique et à plat (fini les onglets ; les trois
 * anciens groupes `(library)/(stats)/(settings)` n'ont plus de layout propre, leurs écrans sont
 * des frères de ce Stack), surmonté d'un mini-player persistant et du menu latéral (drawer).
 */
export default function AppLayout() {
  const insets = useSafeAreaInsets();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Le hamburger (n'importe quel écran) demande l'ouverture via le store `openDrawer`.
  useEffect(() => subscribeOpenDrawer(() => setDrawerOpen(true)), []);

  // Bouton retour matériel Android. Priorité : fermer le drawer s'il est ouvert, sinon dépiler la
  // pile (`router.back` reste le chemin fiable). Ref pour lire l'état courant sans réenregistrer
  // le handler à chaque changement d'ouverture.
  const drawerOpenRef = useRef(drawerOpen);
  useEffect(() => {
    drawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (drawerOpenRef.current) {
        setDrawerOpen(false);
        return true;
      }
      if (router.canDismiss()) {
        router.back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
        {/* Chrome bas persistant : le mini-player (masqué tant qu'aucune piste) posé au-dessus de
            l'inset système. Sa hauteur mesurée positionne le toast (cf. bottomChrome). */}
        <View
          style={{ backgroundColor: colors.surfaceNav, paddingBottom: insets.bottom }}
          onLayout={(e) => reportBottomChromeHeight(e.nativeEvent.layout.height)}
        >
          <MiniPlayer />
        </View>
      </View>

      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </View>
  );
}
