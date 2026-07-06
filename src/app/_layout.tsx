import {
  SchibstedGrotesk_400Regular,
  SchibstedGrotesk_500Medium,
  SchibstedGrotesk_600SemiBold,
  SchibstedGrotesk_700Bold,
  SchibstedGrotesk_800ExtraBold,
} from '@expo-google-fonts/schibsted-grotesk';
import { MaterialSymbols_400Regular } from '@expo-google-fonts/material-symbols';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { PlayerProvider } from '@/player/PlayerProvider';
import { LibraryProvider } from '@/library/LibraryProvider';
import { PlaylistsProvider } from '@/library/PlaylistsProvider';
import { SyncProvider } from '@/sync/SyncProvider';

// Garde le splash affiché tant que les polices ET la session ne sont pas prêtes.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SchibstedGrotesk_400Regular,
    SchibstedGrotesk_500Medium,
    SchibstedGrotesk_600SemiBold,
    SchibstedGrotesk_700Bold,
    SchibstedGrotesk_800ExtraBold,
    MaterialSymbols_400Regular,
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <LibraryProvider>
          <PlaylistsProvider>
            <SyncProvider>
              <PlayerProvider>
                <RootNavigator fontsReady={loaded || error != null} />
              </PlayerProvider>
            </SyncProvider>
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

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  // Splash visible tant que polices/session ne sont pas prêtes.
  if (!ready) {
    return null;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Écrans accessibles une fois connecté. */}
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
        {/* Écran Lecture présenté en modal, au-dessus de la tab bar. */}
        <Stack.Screen name="now-playing" options={{ presentation: 'modal' }} />
        {/* File d'attente, également en modal. */}
        <Stack.Screen name="queue" options={{ presentation: 'modal' }} />
        {/* Réglages > Bibliothèque locale (dossiers scannés / exclusions). */}
        <Stack.Screen name="library-settings" />
        {/* Détails Bibliothèque (poussés) : morceaux d'un artiste / pistes d'un album. */}
        <Stack.Screen name="artist" />
        <Stack.Screen name="album" />
        {/* Détail d'une playlist (poussé). */}
        <Stack.Screen name="playlist" />
      </Stack.Protected>

      {/* Porte d'entrée quand la session est absente. */}
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
