import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import { tapLight, tapMedium } from '@/lib/haptics';
import { SPRING_BOUNCY } from '@/lib/motion';
import { useFavorites } from '@/library/FavoritesProvider';

/**
 * Cœur « favori » d'une piste (mini-lecteur, écran Lecture).
 *
 * Au like, le cœur se remplit et « bat » : il gonfle d'un coup puis retombe sur un ressort, avec
 * un cran haptique marqué. Le retrait est volontairement plus discret (léger creux), pour que les
 * deux sens ne se confondent pas.
 */
export function HeartButton({
  trackId,
  size = 22,
  style,
  toast = false,
}: {
  trackId: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Confirme l'action par un toast (utile quand le cœur est petit, comme dans le mini-lecteur). */
  toast?: boolean;
}) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const liked = isFavorite(trackId);
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const onPress = () => {
    const nowLiked = toggleFavorite(trackId);
    if (nowLiked) {
      tapMedium();
      scale.set(withSequence(withTiming(1.35, { duration: 110 }), withSpring(1, SPRING_BOUNCY)));
    } else {
      tapLight();
      scale.set(withSequence(withTiming(0.82, { duration: 90 }), withSpring(1, SPRING_BOUNCY)));
    }
    if (toast) {
      showToast(nowLiked ? 'Ajouté aux favoris' : 'Retiré des favoris', 'favorite');
    }
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={style}
      accessibilityRole="button"
      accessibilityState={{ selected: liked }}
      accessibilityLabel={liked ? 'Retirer des favoris' : 'Ajouter aux favoris'}
    >
      <Animated.View style={animatedStyle}>
        <Icon
          name={liked ? 'favorite' : 'favorite_border'}
          filled={liked}
          size={size}
          color={liked ? colors.accent : colors.textSecondary}
        />
      </Animated.View>
    </Pressable>
  );
}

export default HeartButton;
