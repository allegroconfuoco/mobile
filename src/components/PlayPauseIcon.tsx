import { StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';

import { colors } from '@/theme';
import { Icon } from '@/components/Icon';
import { SPRING_BOUNCY, useSpringFlag } from '@/lib/motion';

/**
 * Icône lecture / pause qui se transforme au lieu de sauter d'un glyphe à l'autre : l'ancienne
 * icône rétrécit en tournant d'un quart de tour pendant que la nouvelle prend sa place sur un
 * ressort. Les deux glyphes restent montés et superposés, seules leur opacité et leur
 * transformation changent.
 */
export function PlayPauseIcon({
  playing,
  size = 30,
  color = colors.textPrimary,
}: {
  playing: boolean;
  size?: number;
  color?: string;
}) {
  // 1 = pause visible (lecture en cours), 0 = lecture visible.
  const t = useSpringFlag(playing, SPRING_BOUNCY);

  const pauseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.get(), [0.2, 0.8], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: 0.5 + 0.5 * t.get() }, { rotate: `${(t.get() - 1) * 90}deg` }],
  }));
  const playStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.get(), [0.2, 0.8], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: 1 - 0.5 * t.get() }, { rotate: `${t.get() * 90}deg` }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[styles.layer, pauseStyle]}>
        <Icon name="pause" size={size} color={color} />
      </Animated.View>
      <Animated.View style={[styles.layer, playStyle]}>
        <Icon name="play_arrow" size={size} color={color} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});

export default PlayPauseIcon;
