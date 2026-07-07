import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing } from '@/theme';

/**
 * Feuille basse animée (slide-up), mutualisée par les bottom sheets de l'app.
 *
 * Motion design en API `Animated` du cœur RN (pas de Reanimated, cf. parti pris projet) : la
 * feuille glisse depuis le bas et le fond se fond à l'ouverture ; à la fermeture, elle rejoue en
 * sens inverse **avant** de démonter la `Modal` (on garde `mounted` le temps de l'animation de
 * sortie). Un tap sur le fond ferme ; la feuille elle-même avale le tap (Pressable interne).
 */
export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  accessibilityLabel?: string;
};

// Distance de départ hors écran : plus grande que n'importe quelle feuille (la partie au-delà du
// bas de l'écran est invisible, donc on ne voit que l'entrée finale — un slide-up franc).
const OFFSCREEN = 700;

export function BottomSheet({
  visible,
  onClose,
  children,
  accessibilityLabel = 'Fermer le menu',
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(OFFSCREEN));
  const [opacity] = useState(() => new Animated.Value(0));
  // Reste monté le temps de l'animation de sortie, même après `visible = false`.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      // Monte la Modal avant d'animer l'entrée (synchro légitime prop→montage).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          speed: 18,
          bounciness: 4,
        }),
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(translateY, { toValue: OFFSCREEN, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) {
          setMounted(false);
        }
      });
    }
  }, [visible, mounted, translateY, opacity]);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={accessibilityLabel}
        />
        <Animated.View style={{ transform: [{ translateY }] }}>
          {/* Pressable interne : avale le tap pour ne pas fermer en touchant la feuille. */}
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
            {children}
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.sm,
    // Élévation : la feuille se détache du contenu derrière.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 24,
  },
});

export default BottomSheet;
