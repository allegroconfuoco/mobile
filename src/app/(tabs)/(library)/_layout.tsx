import { Stack } from 'expo-router';

import { colors } from '@/theme';

// Racine de l'onglet Bibliothèque : `index`. Les écrans de détail (artiste, album, playlist…) sont
// poussés dans CE stack, sous la tab bar + mini-player (rendus par le navigateur Tabs parent).
export const unstable_settings = { initialRouteName: 'index' };

/** Pile de navigation de l'onglet Bibliothèque (détails poussés sous la barre persistante). */
export default function LibraryStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
