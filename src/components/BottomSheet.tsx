import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, radii, spacing, typography } from '@/theme';
import { EASE_IN, SPRING_SNAPPY, TIMING_IN, TIMING_OUT } from '@/lib/motion';

/**
 * Feuille basse animée, mutualisée par toutes les feuilles de l'app (actions, tri, playlists,
 * minuteur).
 *
 * Elle monte depuis le bas sur un ressort pendant que le fond s'assombrit, et se referme de trois
 * façons : tap sur le fond, retour Android, ou **glissement vers le bas** depuis sa poignée — la
 * feuille suit alors le doigt et part ou revient selon la distance et la vitesse du geste. À la
 * fermeture, l'animation de sortie se joue en entier avant que la `Modal` ne soit démontée.
 *
 * Le geste ne porte que sur l'en-tête (poignée + titre), pas sur le contenu : une feuille peut
 * contenir une liste défilante, et tirer cette liste vers le bas doit la faire défiler, pas fermer
 * la feuille.
 */
export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Titre affiché dans l'en-tête, sous la poignée. */
  title?: string | null;
  accessibilityLabel?: string;
};

// Position de départ, hors écran quelle que soit la hauteur de la feuille : elle y reste tant que
// sa hauteur réelle n'est pas mesurée, donc rien ne s'affiche avant le début de l'entrée.
const OFFSCREEN = 2000;
/** Fraction de la hauteur au-delà de laquelle relâcher ferme la feuille. */
const DISMISS_RATIO = 0.3;
/** Vitesse vers le bas (px/s) qui ferme la feuille même sur un geste court. */
const DISMISS_VELOCITY = 900;

export function BottomSheet({
  visible,
  onClose,
  children,
  title,
  accessibilityLabel = 'Fermer',
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  // Reste monté le temps de l'animation de sortie, même après `visible = false`.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) {
    setMounted(true);
  }

  const translateY = useSharedValue(OFFSCREEN);
  const backdrop = useSharedValue(0);
  const height = useSharedValue(0);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (visible) {
      backdrop.set(withTiming(1, TIMING_IN));
      return;
    }
    backdrop.set(withTiming(0, TIMING_OUT));
    translateY.set(
      withTiming(height.get() || OFFSCREEN, { duration: 180, easing: EASE_IN }, (finished) => {
        if (finished) {
          scheduleOnRN(setMounted, false);
        }
      })
    );
  }, [visible, mounted, backdrop, translateY, height]);

  // L'entrée part de la mesure : la feuille est posée juste sous l'écran, puis monte. Une feuille
  // dont le contenu change de hauteur une fois ouverte (liste qui se remplit) met seulement sa
  // mesure à jour.
  const onSheetLayout = (e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.height;
    const first = height.get() === 0;
    height.set(measured);
    if (first && visible) {
      translateY.set(measured);
      translateY.set(withSpring(0, SPRING_SNAPPY));
    }
  };

  // La `Modal` démonte son contenu à la fermeture : la prochaine ouverture repart d'une mesure.
  useEffect(() => {
    if (!mounted) {
      height.set(0);
      translateY.set(OFFSCREEN);
    }
  }, [mounted, height, translateY]);

  const drag = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onChange((e) => {
      // Vers le haut, la feuille résiste : elle n'a nulle part où aller.
      const next = translateY.get() + e.changeY;
      translateY.set(next < 0 ? next * 0.25 : next);
    })
    .onEnd((e) => {
      const shouldClose =
        translateY.get() > height.get() * DISMISS_RATIO || e.velocityY > DISMISS_VELOCITY;
      if (shouldClose) {
        scheduleOnRN(onClose);
      } else {
        translateY.set(withSpring(0, { ...SPRING_SNAPPY, velocity: e.velocityY }));
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.get() }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* Les gestes ne traversent pas une `Modal` : elle doit porter sa propre racine. */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
          />
        </Animated.View>
        <Animated.View
          onLayout={onSheetLayout}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }, sheetStyle]}
        >
          <GestureDetector gesture={drag}>
            <View style={styles.header}>
              <View style={styles.grabber} />
              {title ? (
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    // Élévation : la feuille se détache du contenu derrière.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 24,
  },
  header: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
  title: {
    ...typography.label,
    alignSelf: 'stretch',
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});

export default BottomSheet;
