import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { router } from 'expo-router';

import { colors, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { selection as hapticSelection } from '@/lib/haptics';
import { SPRING_BOUNCY, SPRING_SNAPPY, useSpringFlag } from '@/lib/motion';
import { notifyTabReselected, setTab, TAB_ORDER, useTab, type TabKey } from '@/lib/tabs';

const TABS: Record<TabKey, { label: string; icon: IconName }> = {
  tracks: { label: 'Morceaux', icon: 'music_note' },
  playlists: { label: 'Playlists', icon: 'queue_music' },
  artists: { label: 'Artistes', icon: 'person' },
  stats: { label: 'Écoutes', icon: 'graphic_eq' },
};

const INDICATOR_WIDTH = 28;

/**
 * Barre d'onglets du bas : Morceaux, Playlists, Artistes, Écoutes — les quatre destinations du
 * quotidien, toutes à portée de pouce. Les réglages, rares, passent par l'engrenage des en-têtes.
 *
 * Elle reste affichée sur les écrans de détail (artiste, album, playlist…) : toucher un onglet
 * depuis l'un d'eux revient à la racine puis affiche l'onglet. Retoucher l'onglet déjà actif
 * remonte sa liste en haut.
 *
 * Un trait accent glisse sous le doigt d'un onglet à l'autre, et l'icône touchée fait un léger
 * rebond : le changement d'onglet se lit même sans regarder le contenu.
 */
export function TabBar() {
  const tab = useTab();
  const index = TAB_ORDER.indexOf(tab);
  const itemWidth = useSharedValue(0);
  const position = useSharedValue(index);

  useEffect(() => {
    position.set(withSpring(index, SPRING_SNAPPY));
  }, [index, position]);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: itemWidth.get() > 0 ? 1 : 0,
    transform: [
      { translateX: position.get() * itemWidth.get() + (itemWidth.get() - INDICATOR_WIDTH) / 2 },
    ],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    itemWidth.set(e.nativeEvent.layout.width / TAB_ORDER.length);
  };

  const onPress = (key: TabKey) => {
    hapticSelection();
    // Depuis un écran de détail, on revient d'abord à la racine du Stack.
    const onDetail = router.canDismiss();
    if (onDetail) {
      router.dismissAll();
    }
    if (key === tab && !onDetail) {
      notifyTabReselected(key);
      return;
    }
    setTab(key);
  };

  return (
    <View style={styles.bar} onLayout={onLayout} accessibilityRole="tablist">
      <Animated.View style={[styles.indicator, indicatorStyle]} pointerEvents="none" />
      {TAB_ORDER.map((key) => (
        <TabItem
          key={key}
          label={TABS[key].label}
          icon={TABS[key].icon}
          active={key === tab}
          onPress={() => onPress(key)}
        />
      ))}
    </View>
  );
}

function TabItem({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
}) {
  const press = useSharedValue(1);
  const on = useSpringFlag(active);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.get() }, { translateY: -on.get() }],
  }));
  const activeStyle = useAnimatedStyle(() => ({ opacity: on.get() }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press.set(withSpring(0.86, SPRING_BOUNCY))}
      onPressOut={() => press.set(withSpring(1, SPRING_BOUNCY))}
      android_ripple={{ color: colors.borderStrong, borderless: true, radius: 44 }}
      style={styles.item}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      {/* Deux couches superposées (inactive / active) fondues l'une dans l'autre : une couleur de
          texte ne s'anime pas sur le thread d'interface, une opacité si. */}
      <Animated.View style={iconStyle}>
        <Icon name={icon} size={24} color={colors.textMuted} />
        <Animated.View style={[styles.overlay, activeStyle]}>
          <Icon name={icon} size={24} color={colors.accentIcon} />
        </Animated.View>
      </Animated.View>
      <View>
        <Text style={[styles.label, styles.labelInactive]}>{label}</Text>
        <Animated.View style={[styles.overlay, activeStyle]}>
          <Text style={[styles.label, styles.labelActive]}>{label}</Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceNav,
    borderTopWidth: 1,
    borderTopColor: colors.borderFaint,
  },
  indicator: {
    position: 'absolute',
    top: -1,
    left: 0,
    width: INDICATOR_WIDTH,
    height: 2,
    backgroundColor: colors.accent,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 56,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  label: {
    ...typography.tabLabel,
  },
  labelInactive: {
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.accentIcon,
  },
});

export default TabBar;
