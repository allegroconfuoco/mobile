import { Stack } from 'expo-router';

import { colors } from '@/theme';

// Racine de l'onglet Écoutes : `index` (tableau de bord). L'historique complet est poussé dans
// CE stack, sous la tab bar + mini-player (rendus par le navigateur Tabs parent).
export const unstable_settings = { initialRouteName: 'index' };

/** Pile de navigation de l'onglet Écoutes (historique + stats, issue #25). */
export default function StatsStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
