// Imports **profonds** (le fichier .ttf, pas le baril du paquet) : `@expo-google-fonts/*`
// expose un index qui fait `require()` de TOUTES ses variantes, donc importer quatre poids depuis
// le baril embarquait les douze (les huit italiques comprises) — ~800 Ko d'APK pour rien, Metro
// n'ayant aucun moyen de savoir lesquelles servent.
import SchibstedGrotesk_500Medium from '@expo-google-fonts/schibsted-grotesk/500Medium/SchibstedGrotesk_500Medium.ttf';
import SchibstedGrotesk_600SemiBold from '@expo-google-fonts/schibsted-grotesk/600SemiBold/SchibstedGrotesk_600SemiBold.ttf';
import SchibstedGrotesk_700Bold from '@expo-google-fonts/schibsted-grotesk/700Bold/SchibstedGrotesk_700Bold.ttf';
import SchibstedGrotesk_800ExtraBold from '@expo-google-fonts/schibsted-grotesk/800ExtraBold/SchibstedGrotesk_800ExtraBold.ttf';
// Material Symbols **sous-ensemblée** aux ~68 ligatures de `IconName` (12 Ko au lieu des 956 Ko
// de la police complète du paquet npm, qui embarque 4000 icônes dont on en utilise 68).
// Régénération : cf. l'entrée « taille de l'APK » du journal ci-dessous.
import MaterialSymbolsSubset from '../../assets/fonts/MaterialSymbolsOutlined_Subset.ttf';
// Instance FILL=1 (cœur plein) des Material Symbols Outlined, cf. theme.fontFamily.iconsFilled.
// La police par défaut est FILL=0 (contour) : sans elle, un cœur liké ne peut pas être plein.
import MaterialSymbolsFilled from '../../assets/fonts/MaterialSymbolsOutlined_Filled.ttf';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { ToastHost, showToast } from '@/components/Toast';
import { subscribePlaybackError } from '@/player/playbackErrors';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { PlayerProvider } from '@/player/PlayerProvider';
import { LibraryProvider } from '@/library/LibraryProvider';
import { PlaylistsProvider } from '@/library/PlaylistsProvider';
import { FavoritesProvider } from '@/library/FavoritesProvider';
import { SyncProvider } from '@/sync/SyncProvider';
import { useAppVersionCheck } from '@/update/useAppVersionCheck';
import { UpdateModal } from '@/update/UpdateModal';

// Garde le splash affiché tant que les polices ET la session ne sont pas prêtes.
SplashScreen.preventAutoHideAsync();

// Ancre de la pile pour les deep links : au lancement à froid sur un écran ciblé, `(app)` est
// monté SOUS lui, sinon cet écran serait seul dans la pile et « retour » sortirait de l'app.
// (La notification média v5 ouvre l'app par un simple launch intent, sans deep link.)
export const unstable_settings = {
  initialRouteName: '(app)',
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SchibstedGrotesk_500Medium,
    SchibstedGrotesk_600SemiBold,
    SchibstedGrotesk_700Bold,
    SchibstedGrotesk_800ExtraBold,
    // Clés = noms de famille référencés par theme.fontFamily.icons / .iconsFilled.
    MaterialSymbols_400Regular: MaterialSymbolsSubset,
    MaterialSymbolsFilled,
  });

  return (
    // Racine des gestes (carrousel, glissements, feuilles) : tout l'arbre doit être dessous.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <LibraryProvider>
            <PlaylistsProvider>
              <FavoritesProvider>
                <SyncProvider>
                  <PlayerProvider>
                    <RootNavigator fontsReady={loaded || error != null} />
                    {/* Host racine du toast (les modaux natifs montent le leur, cf. Toast.tsx). */}
                    <ToastHost />
                  </PlayerProvider>
                </SyncProvider>
              </FavoritesProvider>
            </PlaylistsProvider>
          </LibraryProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Pile de navigation, gardée par l'état d'authentification.
 *
 * Enfant d'`AuthProvider` pour pouvoir lire `useAuth`. On ne masque le splash (et on ne monte la
 * pile) qu'une fois les polices chargées ET la session restaurée depuis le stockage sécurisé —
 * sinon on flasherait l'écran login avant de savoir qu'on est déjà connecté.
 *
 * `Stack.Protected` (expo-router) redirige automatiquement : connecté → `(app)`, sinon → `login`.
 */
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status, isAuthenticated } = useAuth();
  const ready = fontsReady && status !== 'restoring';
  const version = useAppVersionCheck();
  const [updateDismissed, setUpdateDismissed] = useState(false);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  // Erreurs de lecture (relayées par les événements lecteur, cf. playbackErrors) → toast au premier plan.
  useEffect(() => subscribePlaybackError((e) => showToast(e.message, 'music_off')), []);

  // Splash visible tant que polices/session ne sont pas prêtes.
  if (!ready) {
    return null;
  }

  const showUpdateModal =
    version.status === 'outdated-forced' ||
    (version.status === 'outdated-suggested' && !updateDismissed);

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {/* Écrans accessibles une fois connecté. Les onglets et les écrans de détail vivent dans le
            Stack de `(app)`, au-dessus du mini-lecteur et de la barre d'onglets. Seuls restent au
            niveau racine les écrans qui couvrent toute l'interface, chrome bas compris. */}
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(app)" />
          {/* Lecture : monte du bas par-dessus l'app, qui reste rendue derrière — c'est elle qu'on
              voit réapparaître quand on fait glisser l'écran vers le bas pour le fermer. */}
          <Stack.Screen
            name="now-playing"
            options={{
              presentation: 'transparentModal',
              animation: 'slide_from_bottom',
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
          <Stack.Screen
            name="queue"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack.Protected>

        {/* Porte d'entrée quand la session est absente. */}
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      <UpdateModal
        visible={showUpdateModal}
        forced={version.status === 'outdated-forced'}
        currentVersion={version.currentVersion}
        latestVersion={version.latestVersion}
        downloadUrl={version.downloadUrl}
        onDismiss={() => setUpdateDismissed(true)}
      />
    </>
  );
}
