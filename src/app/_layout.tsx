import {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
  SchibstedGrotesk_800ExtraBold,
} from '@expo-google-fonts/schibsted-grotesk';
import { MaterialSymbols_400Regular } from '@expo-google-fonts/material-symbols';
// Instance FILL=1 (cœur plein) des Material Symbols Outlined, cf. theme.fontFamily.iconsFilled.
// La police par défaut est FILL=0 (contour) : sans elle, un cœur liké ne peut pas être plein.
import MaterialSymbolsFilled from '../../assets/fonts/MaterialSymbolsOutlined_Filled.ttf';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { ToastHost, showToast } from '@/components/Toast';
import { subscribePlaybackError } from '@/player/playbackErrors';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { PlayerProvider } from '@/player/PlayerProvider';
import { LibraryProvider } from '@/library/LibraryProvider';
import { EnrichmentRunner } from '@/library/EnrichmentRunner';
import { PlaylistsProvider } from '@/library/PlaylistsProvider';
import { FavoritesProvider } from '@/library/FavoritesProvider';
import { SyncProvider } from '@/sync/SyncProvider';
import { useAppVersionCheck } from '@/update/useAppVersionCheck';
import { UpdateModal } from '@/update/UpdateModal';

// Garde le splash affiché tant que les polices ET la session ne sont pas prêtes.
SplashScreen.preventAutoHideAsync();

// Ancre de la pile pour les deep links (ex. tap sur la notification média → `/now-playing`, cf.
// `+native-intent.ts`) : au lancement à froid, `(tabs)` est monté SOUS l'écran ciblé, sinon le
// modal Lecture serait seul dans la pile et « retour » sortirait de l'app.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SchibstedGrotesk_400Regular,
    SchibstedGrotesk_500Medium,
    SchibstedGrotesk_600SemiBold,
    SchibstedGrotesk_700Bold,
    SchibstedGrotesk_800ExtraBold,
    MaterialSymbols_400Regular,
    // Clé = nom de famille référencé par theme.fontFamily.iconsFilled.
    MaterialSymbolsFilled,
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <LibraryProvider>
          {/* Enrichissement MusicBrainz de fond (issue #19) : lit useAuth + useLibrary, sans UI. */}
          <EnrichmentRunner />
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
  );
}

/**
 * Pile de navigation, gardée par l'état d'authentification.
 *
 * Enfant d'`AuthProvider` pour pouvoir lire `useAuth`. On ne masque le splash (et on ne monte la
 * pile) qu'une fois les polices chargées ET la session restaurée depuis le stockage sécurisé —
 * sinon on flasherait l'écran login avant de savoir qu'on est déjà connecté.
 *
 * `Stack.Protected` (expo-router) redirige automatiquement : connecté → `(tabs)`, sinon → `login`.
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

  // Erreurs de lecture (relayées par le service RNTP, cf. playbackErrors) → toast au premier plan.
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
        {/* Écrans accessibles une fois connecté. Les écrans de détail (artiste, album, playlist,
            favoris, réglages…) vivent désormais DANS les stacks d'onglet (cf. (tabs)/(library) et
            (tabs)/(settings)) pour garder la tab bar + le mini-player visibles. Seuls restent au
            niveau racine les modaux, qui doivent couvrir toute l'UI, barre comprise. */}
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(tabs)" />
          {/* Écran Lecture présenté en modal, au-dessus de la tab bar. */}
          <Stack.Screen name="now-playing" options={{ presentation: 'modal' }} />
          {/* File d'attente, également en modal. */}
          <Stack.Screen name="queue" options={{ presentation: 'modal' }} />
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
