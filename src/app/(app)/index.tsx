import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors } from '@/theme';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { TAB_ORDER, useTab, type TabKey } from '@/lib/tabs';
import { ArtistsTab } from '@/tabs/ArtistsTab';
import { PlaylistsTab } from '@/tabs/PlaylistsTab';
import { StatsTab } from '@/tabs/StatsTab';
import { TracksTab } from '@/tabs/TracksTab';

/** Décalage horizontal (px) d'où arrive le panneau qui entre. */
const SLIDE = 16;

/**
 * Racine de l'app : les quatre onglets, chacun dans un panneau qui occupe tout l'écran.
 *
 * Les panneaux restent **montés** une fois visités (montés à la demande : seul Morceaux l'est à
 * l'ouverture, pour démarrer vite). Changer d'onglet ne fait donc que montrer un panneau déjà
 * prêt : c'est immédiat, et chaque liste retrouve sa position de défilement.
 *
 * La transition est un « fondu enchaîné glissé » : le panneau sortant s'efface sur place, l'entrant
 * apparaît en glissant de quelques pixels depuis le côté où se trouve son onglet. Visibilité et
 * mouvement dérivent de la même valeur, calculée sur le thread d'interface.
 */
export default function TabsScreen() {
  const tab = useTab();
  const index = TAB_ORDER.indexOf(tab);

  // Onglets déjà visités (montage à la demande), ajustés pendant le rendu.
  const [visited, setVisited] = useState<ReadonlySet<TabKey>>(() => new Set([tab]));
  if (!visited.has(tab)) {
    setVisited(new Set([...visited, tab]));
  }

  const active = useSharedValue(index);
  useEffect(() => {
    active.set(index);
  }, [index, active]);

  return (
    <View style={styles.screen}>
      {TAB_ORDER.map((key, i) =>
        visited.has(key) ? (
          <TabPane key={key} index={i} active={active} focused={key === tab}>
            {key === 'tracks' && <TracksTab />}
            {key === 'playlists' && <PlaylistsTab />}
            {key === 'artists' && <ArtistsTab />}
            {key === 'stats' && <StatsTab focused={key === tab} />}
          </TabPane>
        ) : null
      )}
    </View>
  );
}

function TabPane({
  index,
  active,
  focused,
  children,
}: {
  index: number;
  active: SharedValue<number>;
  focused: boolean;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const current = active.get();
    const shown = current === index;
    return {
      // Sortie plus courte que l'entrée : ce qui part ne doit pas retenir l'œil.
      opacity: withTiming(shown ? 1 : 0, { duration: shown ? DURATION.base : DURATION.fast }),
      transform: [
        {
          translateX: withTiming(shown ? 0 : index < current ? -SLIDE : SLIDE, {
            duration: DURATION.base,
            easing: EASE_OUT,
          }),
        },
      ],
    };
  });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      // Un panneau masqué reste monté mais ne doit ni capter les touchers ni être lu.
      pointerEvents={focused ? 'auto' : 'none'}
      accessibilityElementsHidden={!focused}
      importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
