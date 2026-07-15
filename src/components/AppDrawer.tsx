import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useLocalSearchParams, type Href } from 'expo-router';

import { useRouter } from '@/lib/useRouter';
import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Menu latéral (drawer) maison — remplace la barre d'onglets (cf. `(app)/_layout.tsx`).
 *
 * Overlay unique posé au-dessus de toute l'app : un panneau glisse depuis la gauche, un scrim
 * sombre couvre le reste. Animé avec l'API `Animated` du cœur RN (pas de gesture-handler, comme
 * le MiniPlayer/Toast) : une **seule** valeur `tx` = décalage horizontal du panneau (0 = ouvert,
 * `-PANEL_WIDTH` = fermé) pilote à la fois l'ouverture, la fermeture et le geste de glissement, ce
 * qui évite tout saut visuel (le geste enchaîne directement sur l'animation de fermeture).
 *
 * L'état d'ouverture (`open`) vit dans le layout parent, qui s'abonne au store `openDrawer`. La
 * fermeture est locale : tap sur le scrim, glissement vers la gauche, ou bouton retour Android
 * (géré par le layout). Le swipe-to-open depuis le bord n'est pas géré (on ouvre au hamburger).
 */

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANEL_WIDTH = Math.min(320, Math.round(SCREEN_WIDTH * 0.82));
// Au-delà (ou vitesse suffisante), un glissement vers la gauche ferme le menu.
const CLOSE_DISTANCE = PANEL_WIDTH * 0.35;

type MenuItem = {
  /** Clé d'état actif (comparée au chemin / au param `view`). */
  key: string;
  icon: IconName;
  label: string;
  href: Href;
};

const PRIMARY: MenuItem[] = [
  { key: 'home', icon: 'dashboard', label: 'Accueil', href: '/' },
  {
    key: 'tracks',
    icon: 'music_note',
    label: 'Morceaux',
    href: { pathname: '/library', params: { view: 'tracks' } },
  },
  {
    key: 'artists',
    icon: 'group',
    label: 'Artistes',
    href: { pathname: '/library', params: { view: 'artists' } },
  },
  {
    key: 'albums',
    icon: 'album',
    label: 'Albums',
    href: { pathname: '/library', params: { view: 'albums' } },
  },
  {
    key: 'playlists',
    icon: 'queue_music',
    label: 'Playlists',
    href: { pathname: '/library', params: { view: 'playlists' } },
  },
  { key: 'favorites', icon: 'favorite', label: 'Favoris', href: '/favorites' },
];

const SECONDARY: MenuItem[] = [
  { key: 'stats', icon: 'graphic_eq', label: 'Écoutes', href: '/stats' },
  { key: 'settings', icon: 'settings', label: 'Réglages', href: '/settings' },
];

export function AppDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ view?: string }>();

  // Valeur animée stable via `useState` (pas `useRef().current`, que la règle react-hooks/refs
  // interdit de lire en rendu) — même motif que le MiniPlayer et le Toast.
  const [tx] = useState(() => new Animated.Value(open ? 0 : -PANEL_WIDTH));

  // L'ouverture/fermeture est pilotée par le prop `open` (le layout) : l'effet ne fait que lancer
  // l'animation (aucun setState, cf. règle set-state-in-effect). L'overlay reste toujours monté
  // mais devient non-interactif et hors de l'arbre d'accessibilité quand fermé (cf. `pointerEvents`
  // et `importantForAccessibility` plus bas) — pas d'état monté/démonté à synchroniser. L'animation
  // part de la position courante de `tx` : un geste déjà amorcé enchaîne directement sur la sortie.
  useEffect(() => {
    if (open) {
      Animated.spring(tx, {
        toValue: 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 2,
      }).start();
    } else {
      Animated.timing(tx, {
        toValue: -PANEL_WIDTH,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [open, tx]);

  // Glissement vers la gauche pour fermer. Ne capte que l'horizontal-gauche (laisse un éventuel
  // défilement vertical du menu). Au relâchement : au-delà du seuil (ou assez vif) → fermeture
  // (via `onClose`, qui rebascule `open` et laisse l'effet animer depuis la position courante) ;
  // sinon retour ouvert.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_e, g) => {
          tx.setValue(Math.min(0, g.dx));
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -CLOSE_DISTANCE || g.vx < -0.5) {
            onClose();
          } else {
            Animated.spring(tx, {
              toValue: 0,
              useNativeDriver: true,
              speed: 20,
              bounciness: 4,
            }).start();
          }
        },
      }),
    [tx, onClose]
  );

  const scrimOpacity = tx.interpolate({
    inputRange: [-PANEL_WIDTH, 0],
    outputRange: [0, 0.55],
    extrapolate: 'clamp',
  });

  const currentView =
    params.view === 'artists' || params.view === 'albums' || params.view === 'playlists'
      ? params.view
      : 'tracks';

  const isActive = (key: string): boolean => {
    switch (key) {
      case 'home':
        return pathname === '/';
      case 'favorites':
        return pathname === '/favorites';
      case 'stats':
        return pathname === '/stats';
      case 'settings':
        return pathname === '/settings';
      default:
        // Sous-vues de la bibliothèque : même écran, distinguées par le param `view`.
        return pathname === '/library' && key === currentView;
    }
  };

  const go = (item: MenuItem) => {
    onClose();
    // Repart toujours d'une pile propre [Accueil, section] : le retour depuis une section ramène à
    // l'accueil, et `/library` se remonte (le param `view` d'entrée est relu proprement).
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.navigate(item.href);
  };

  const renderItem = (item: MenuItem) => {
    const active = isActive(item.key);
    return (
      <Pressable
        key={item.key}
        onPress={() => go(item)}
        android_ripple={{ color: colors.borderStrong }}
        style={({ pressed }) => [
          styles.item,
          active && styles.itemActive,
          pressed && styles.itemPressed,
        ]}
        accessibilityRole="button"
        accessibilityState={active ? { selected: true } : {}}
        accessibilityLabel={item.label}
      >
        <Icon
          name={item.icon}
          filled={item.key === 'favorites' && active}
          size={22}
          color={active ? colors.accentIcon : colors.textSecondary}
        />
        <Text style={[styles.itemLabel, active && styles.itemLabelActive]} numberOfLines={1}>
          {item.label}
        </Text>
      </Pressable>
    );
  };

  return (
    // Toujours monté ; fermé = transparent (scrim opacity 0), panneau hors écran (tx), et surtout
    // non-interactif + hors arbre a11y pour ne rien capter ni annoncer derrière l'app.
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityViewIsModal={open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Fermer le menu"
        />
      </Animated.View>

      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.panel,
          { paddingTop: insets.top + spacing.xl, transform: [{ translateX: tx }] },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.wordmark}>Fuoco</Text>
          <Text style={styles.tagline}>Ta musique, à toi</Text>
        </View>

        <View style={styles.group}>{PRIMARY.map(renderItem)}</View>
        <View style={styles.divider} />
        <View style={styles.group}>{SECONDARY.map(renderItem)}</View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: PANEL_WIDTH,
    backgroundColor: colors.surfaceNav,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  wordmark: {
    ...typography.display,
    fontSize: 26,
    color: colors.accent,
  },
  tagline: {
    ...typography.label,
    fontSize: 10,
    marginTop: spacing.xs,
  },
  group: {
    gap: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
    marginHorizontal: spacing.md,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    // Réserve la place du liseré actif pour éviter tout décalage à la sélection.
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  itemActive: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.accent,
  },
  itemPressed: {
    backgroundColor: colors.surface,
  },
  itemLabel: {
    ...typography.heading,
    color: colors.textSecondary,
  },
  itemLabelActive: {
    color: colors.textPrimary,
  },
});

export default AppDrawer;
