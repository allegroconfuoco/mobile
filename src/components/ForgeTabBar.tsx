import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { MiniPlayer } from '@/components/MiniPlayer';

/**
 * Barre de navigation « Forge » (Direction B) + mini-player persistant.
 *
 * Rendue via la prop `tabBar` de <Tabs> (cf. src/app/(tabs)/_layout.tsx). On dessine
 * nous-mêmes la barre pour coller au mockup : à plat, labels en majuscules, liseré
 * accent sur l'onglet actif, icônes Material Symbols.
 */

/** Icône associée à chaque route de la tab bar (clé = nom du groupe/onglet). */
const TAB_ICONS: Record<string, IconName> = {
  '(library)': 'library_music',
  '(settings)': 'settings',
};

export function ForgeTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.wrapper}>
      <MiniPlayer />

      <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const { options } = descriptors[route.key];
          // tabBarLabel peut être une fonction de rendu : on s'en tient au titre.
          const label = options.title ?? route.name;
          const tint = isFocused ? colors.accentIcon : colors.textMuted;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={[styles.tab, isFocused && styles.tabActive]}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={label}
            >
              <Icon name={TAB_ICONS[route.name] ?? 'home'} size={24} color={tint} />
              <Text style={[styles.label, { color: tint }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surfaceNav,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceNav,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: 11,
    paddingBottom: spacing.sm,
    // Réserve la place du liseré actif pour éviter tout saut de mise en page.
    borderTopWidth: 2,
    borderTopColor: 'transparent',
    marginTop: -1,
  },
  tabActive: {
    borderTopColor: colors.accent,
  },
  label: {
    ...typography.tabLabel,
  },
});

export default ForgeTabBar;
