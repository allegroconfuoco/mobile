import { type ReactNode } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { tapLight } from '@/lib/haptics';
import { SPRING_BOUNCY } from '@/lib/motion';

/**
 * `Pressable` qui rétrécit à l'appui puis revient avec un léger rebond (retour tactile
 * « physique »). L'échelle est animée sur le thread d'interface : la réponse au doigt ne dépend
 * pas de la charge du JS.
 *
 * S'utilise comme un `Pressable` : `style` s'applique à la zone pressable, le reste des props
 * (`onPress`, `accessibilityRole`…) est transmis tel quel.
 */
type PressableScaleProps = Omit<PressableProps, 'style'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Facteur d'échelle à l'appui (défaut 0.94). */
  activeScale?: number;
  /** Déclenche une haptique légère au press-in. */
  haptic?: boolean;
};

export function PressableScale({
  children,
  style,
  activeScale = 0.94,
  haptic = false,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const handlePressIn = (e: GestureResponderEvent) => {
    if (haptic) {
      tapLight();
    }
    scale.set(withSpring(activeScale, SPRING_BOUNCY));
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    scale.set(withSpring(1, SPRING_BOUNCY));
    onPressOut?.(e);
  };

  // Le `style` va sur le `Pressable` (layout + visuel des enfants) ; le conteneur animé ne porte
  // que la transformation d'échelle, pour ne pas perturber la disposition (lignes, padding…).
  return (
    <Animated.View style={animatedStyle}>
      <Pressable style={style} onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

export default PressableScale;
