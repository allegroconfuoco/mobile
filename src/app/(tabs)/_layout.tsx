import { Tabs } from 'expo-router/js-tabs';

import { ForgeTabBar } from '@/components/ForgeTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <ForgeTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Biblio' }} />
      <Tabs.Screen name="settings" options={{ title: 'Réglages' }} />
    </Tabs>
  );
}
