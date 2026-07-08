import { Tabs } from 'expo-router/js-tabs';

import { ForgeTabBar } from '@/components/ForgeTabBar';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <ForgeTabBar {...props} />}>
      {/* Chaque onglet est un Stack (groupe entre parenthèses, invisible dans l'URL) : les écrans de
          détail y sont poussés en gardant la tab bar + le mini-player visibles. */}
      <Tabs.Screen name="(library)" options={{ title: 'Biblio' }} />
      <Tabs.Screen name="(settings)" options={{ title: 'Réglages' }} />
    </Tabs>
  );
}
