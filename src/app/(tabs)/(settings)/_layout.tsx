import { Stack } from 'expo-router';

import { colors } from '@/theme';

// Racine de l'onglet Réglages : `settings`. Les sous-écrans (bibliothèque locale, lecture) sont
// poussés dans CE stack, sous la tab bar + mini-player (rendus par le navigateur Tabs parent).
export const unstable_settings = { initialRouteName: 'settings' };

/** Pile de navigation de l'onglet Réglages (sous-écrans poussés sous la barre persistante). */
export default function SettingsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
