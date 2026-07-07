import { useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { tapLight } from '@/lib/haptics';

/**
 * `Pressable` qui rétrécit légèrement à l'appui (retour tactile « physique »).
 *
 * Animation via l'API `Animated` du cœur RN (pas de Reanimated : cf. parti pris projet, aucun
 * rebuild natif). Le `scale` descend à `activeScale` au press-in via un `spring`, remonte à 1 au
 * press-out. Haptique légère optionnelle au press-in.
 *
 * S'utilise comme un `Pressable` : `style` s'applique au conteneur animé, le reste des props
 * (`onPress`, `accessibilityRole`…) est transmis tel quel.
 */
type PressableScaleProps = Omit<PressableProps, 'style'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Facteur d'échelle à l'appui (défaut 0.96). */
  activeScale?: number;
  /** Déclenche une haptique légère au press-in. */
  haptic?: boolean;
};

export function PressableScale({
  children,
  style,
  activeScale = 0.96,
  haptic = false,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const [scale] = useState(() => new Animated.Value(1));

  const animateTo = (to: number) => {
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };

  const handlePressIn = (e: GestureResponderEvent) => {
    if (haptic) {
      tapLight();
    }
    animateTo(activeScale);
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    animateTo(1);
    onPressOut?.(e);
  };

  // Le `style` va sur le `Pressable` (layout + visuel des enfants) ; le conteneur animé ne porte
  // que la transformation d'échelle, pour ne pas perturber la disposition (lignes, padding…).
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable style={style} onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

export default PressableScale;
