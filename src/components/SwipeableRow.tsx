import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { TRACK_ROW_HEIGHT } from '@/components/TrackRow';
import { selection as hapticSelection } from '@/lib/haptics';
import { SPRING_SNAPPY } from '@/lib/motion';

/**
 * Ligne de liste glissable vers la droite pour déclencher une action — chez nous « Lire ensuite ».
 *
 * La ligne suit le doigt et découvre un fond accent portant l'icône et le libellé de l'action.
 * Passé le seuil, l'icône grossit et le téléphone donne un cran haptique : on sait qu'on peut
 * lâcher sans lire. Au relâchement, la ligne revient sur un ressort, l'action étant déclenchée si
 * le seuil était franchi.
 *
 * Deux contraintes tiennent le composant :
 *  - **le défilement vertical de la liste reste prioritaire** : le geste ne s'active que sur un
 *    mouvement franchement horizontal vers la droite, et abandonne dès que le doigt part en
 *    vertical. Le tap et l'appui long de la ligne ne sont pas concernés ;
 *  - **la hauteur reste exactement `TRACK_ROW_HEIGHT`**, contrat du `getItemLayout` des listes
 *    virtualisées.
 */

/** Distance à franchir pour valider. En deçà, la ligne revient sans rien déclencher. */
const TRIGGER_DISTANCE = 88;
/** Résistance appliquée au-delà du seuil : inutile de traîner la ligne à l'infini. */
const OVERSHOOT_RATIO = 0.25;

export type SwipeableRowProps = {
  children: ReactNode;
  /** Action déclenchée au relâchement au-delà du seuil. */
  onSwipe: () => void;
  /** Libellé et icône révélés sous la ligne pendant le glissement. */
  label: string;
  icon: IconName;
  /** Faux pour neutraliser le geste (mode sélection). */
  enabled?: boolean;
};

export function SwipeableRow({
  children,
  onSwipe,
  label,
  icon,
  enabled = true,
}: SwipeableRowProps) {
  const translateX = useSharedValue(0);
  // Vrai tant que le doigt est au-delà du seuil : sert au cran haptique (une fois par passage).
  const armed = useSharedValue(false);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(14)
    .failOffsetX(-14)
    .failOffsetY([-10, 10])
    .onChange((e) => {
      const dx = Math.max(0, e.translationX);
      translateX.set(
        dx > TRIGGER_DISTANCE ? TRIGGER_DISTANCE + (dx - TRIGGER_DISTANCE) * OVERSHOOT_RATIO : dx
      );
      const past = dx >= TRIGGER_DISTANCE;
      if (past !== armed.get()) {
        armed.set(past);
        if (past) {
          scheduleOnRN(hapticSelection);
        }
      }
    })
    .onEnd(() => {
      if (armed.get()) {
        scheduleOnRN(onSwipe);
      }
    })
    .onFinalize(() => {
      armed.set(false);
      translateX.set(withSpring(0, SPRING_SNAPPY));
    });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.get() }] }));
  const actionStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.get(),
      [0, TRIGGER_DISTANCE * 0.4, TRIGGER_DISTANCE],
      [0, 0.55, 1],
      Extrapolation.CLAMP
    ),
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(armed.get() ? 1.25 : 1, SPRING_SNAPPY) }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.action, actionStyle]} pointerEvents="none">
        <Animated.View style={iconStyle}>
          <Icon name={icon} size={20} color={colors.onAccent} />
        </Animated.View>
        <Text style={styles.actionLabel} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.row, rowStyle]}>{children}</Animated.View>
      </GestureDetector>
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
  // Fond opaque : la couche mobile doit masquer le fond accent tant qu'elle est en place.
  row: {
    height: TRACK_ROW_HEIGHT,
    backgroundColor: colors.background,
  },
});

export default SwipeableRow;
