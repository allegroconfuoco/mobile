import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useIsPlaying } from '@rntp/player';

import { colors } from '@/theme';

/**
 * Trois barres d'égaliseur qui battent tant que la musique joue et se figent en pause : marque la
 * ligne de la piste en cours et dit, d'un coup d'œil, si elle est en lecture.
 *
 * Purement décoratif (aucune analyse du signal) : chaque barre oscille à son rythme, sur le thread
 * d'interface. Un seul exemplaire est monté à la fois par liste — celui de la ligne active — donc
 * le coût est négligeable.
 */

const BAR_HEIGHT = 14;
/** Hauteur relative de repos (pause) et rythme de chaque barre. */
const BARS = [
  { rest: 0.45, up: 360, down: 420, delay: 0 },
  { rest: 0.85, up: 300, down: 340, delay: 120 },
  { rest: 0.6, up: 420, down: 380, delay: 60 },
] as const;

export function EqualizerBars({ color = colors.accentIcon }: { color?: string }) {
  const playing = useIsPlaying();
  const a = useSharedValue<number>(BARS[0].rest);
  const b = useSharedValue<number>(BARS[1].rest);
  const c = useSharedValue<number>(BARS[2].rest);

  useEffect(() => {
    const values = [a, b, c];
    values.forEach((value, i) => {
      const bar = BARS[i];
      if (!playing) {
        cancelAnimation(value);
        value.set(withTiming(bar.rest, { duration: 180 }));
        return;
      }
      value.set(
        withDelay(
          bar.delay,
          withRepeat(
            withSequence(
              withTiming(1, { duration: bar.up, easing: Easing.inOut(Easing.quad) }),
              withTiming(0.25, { duration: bar.down, easing: Easing.inOut(Easing.quad) })
            ),
            -1,
            true
          )
        )
      );
    });
    return () => values.forEach((value) => cancelAnimation(value));
  }, [playing, a, b, c]);

  return (
    <View style={styles.bars} accessible={false}>
      <Bar value={a} color={color} />
      <Bar value={b} color={color} />
      <Bar value={c} color={color} />
    </View>
  );
}

function Bar({ value, color }: { value: SharedValue<number>; color: string }) {
  // `scaleY` ancré en bas (le translate compense le centre de l'échelle) : seule une transformation
  // est animée, jamais la mise en page.
  const style = useAnimatedStyle(() => {
    const scale = value.get();
    return { transform: [{ translateY: (BAR_HEIGHT * (1 - scale)) / 2 }, { scaleY: scale }] };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: BAR_HEIGHT,
  },
  bar: {
    width: 3,
    height: BAR_HEIGHT,
    borderRadius: 1,
  },
});

export default EqualizerBars;
