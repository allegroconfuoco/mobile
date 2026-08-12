import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { TRACK_ROW_HEIGHT } from '@/components/TrackRow';

/**
 * Ligne de liste glissable vers la droite pour déclencher une action — chez nous « Lire ensuite »,
 * qui coûtait sinon appui long → feuille → action.
 *
 * `Animated` + `PanResponder` du cœur RN, comme tous les gestes du projet (mini-player, lecteur,
 * drawer, deck de tri) : react-native-gesture-handler n'est pas câblé et ses dépendances natives
 * pèsent lourd pour rien.
 *
 * Deux contraintes tiennent tout le composant :
 *  - **le scroll vertical de la FlatList doit rester intouché** : le responder n'accepte le geste
 *    que s'il est franchement horizontal ET vers la droite (`dx > dy × 2`), sinon la liste garde
 *    la main. Le geste n'est jamais capté au `Start`, seulement au `Move`, donc le tap et l'appui
 *    long de la ligne fonctionnent normalement ;
 *  - **la hauteur doit rester exactement `TRACK_ROW_HEIGHT`**, contrat du `getItemLayout` des
 *    listes virtualisées.
 */

/** Distance à franchir pour valider. En deçà, la ligne revient sans rien déclencher. */
const TRIGGER_DISTANCE = 96;
/** Résistance appliquée au-delà du seuil : inutile de traîner la ligne à l'infini. */
const OVERSHOOT_RATIO = 0.3;
/** Mouvement minimal avant de prendre la main sur la liste. */
const CAPTURE_SLOP = 12;

export type SwipeableRowProps = {
  children: ReactNode;
  /** Action déclenchée au relâchement au-delà du seuil. */
  onSwipe: () => void;
  /** Libellé et icône révélés sous la ligne pendant le glissement. */
  label: string;
  icon: IconName;
  /** Faux pour neutraliser le geste (mode sélection, liste réordonnable). */
  enabled?: boolean;
};

export function SwipeableRow({
  children,
  onSwipe,
  label,
  icon,
  enabled = true,
}: SwipeableRowProps) {
  const [translateX] = useState(() => new Animated.Value(0));

  // L'action change à chaque rendu du parent (closure sur la piste) mais le responder, lui, ne
  // doit être créé qu'une fois : on la lit via une ref pour ne jamais capturer une closure périmée.
  // Mise à jour en effet sans dépendances (motif du MiniPlayer) : écrire une ref pendant le rendu
  // est interdit par `react-hooks/refs`.
  const latestRef = useRef({ onSwipe, enabled });
  useEffect(() => {
    latestRef.current = { onSwipe, enabled };
  });

  const springBack = () => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();
  };

  /* eslint-disable react-hooks/refs */
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Jamais au Start : le tap et l'appui long de la ligne doivent passer.
        onMoveShouldSetPanResponder: (_e, g) =>
          latestRef.current.enabled && g.dx > CAPTURE_SLOP && g.dx > Math.abs(g.dy) * 2,
        onPanResponderMove: (_e, g) => {
          // Vers la gauche : rien (une seule action, à droite). Résistance passé le seuil.
          const dx = Math.max(0, g.dx);
          translateX.setValue(
            dx > TRIGGER_DISTANCE
              ? TRIGGER_DISTANCE + (dx - TRIGGER_DISTANCE) * OVERSHOOT_RATIO
              : dx
          );
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dx >= TRIGGER_DISTANCE) {
            latestRef.current.onSwipe();
          }
          springBack();
        },
        onPanResponderTerminate: springBack,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [translateX]
  );
  /* eslint-enable react-hooks/refs */

  return (
    <View style={styles.container}>
      {/* Fond révélé : n'apparaît qu'une fois le geste engagé, et se colore à pleine intensité
          quand le seuil est franchi — le pouce sait qu'il peut lâcher sans regarder le libellé. */}
      <Animated.View
        style={[
          styles.action,
          {
            opacity: translateX.interpolate({
              inputRange: [0, TRIGGER_DISTANCE / 2, TRIGGER_DISTANCE],
              outputRange: [0, 0.6, 1],
              extrapolate: 'clamp',
            }),
          },
        ]}
        pointerEvents="none"
      >
        <Icon name={icon} size={20} color={colors.onAccent} />
        <Text style={styles.actionLabel} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
      <Animated.View
        {...responder.panHandlers}
        style={[styles.row, { transform: [{ translateX }] }]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: TRACK_ROW_HEIGHT,
  },
  action: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.xl,
    backgroundColor: colors.accent,
  },
  actionLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.onAccent,
  },
  // Fond opaque obligatoire : sans lui, le fond d'action resterait visible sous la ligne.
  row: {
    height: TRACK_ROW_HEIGHT,
    backgroundColor: colors.background,
  },
});

export default SwipeableRow;
