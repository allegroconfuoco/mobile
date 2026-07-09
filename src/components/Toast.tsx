import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { getBottomChromeHeight, subscribeBottomChromeHeight } from '@/lib/bottomChrome';

/**
 * Toast maison (confirmation légère, non bloquante) — remplace les `Alert` de simple feedback.
 *
 * Pas de contexte React : `showToast` est un store de module (comme `playbackErrors`), appelable
 * depuis n'importe où, y compris hors composant. Les `ToastHost` montés s'abonnent et affichent.
 *
 * Pourquoi PLUSIEURS hosts : les écrans Lecture et File sont des modaux **natifs**
 * (`presentation: 'modal'`), au-dessus desquels un overlay JS du niveau racine ne passe pas.
 * On monte donc un host à la racine (offset = chrome bas mesuré : tab bar + mini-player) et un
 * dans chaque modal (offset = inset système) ; tous affichent le même toast, seul celui du
 * conteneur natif le plus haut est réellement visible — la duplication est invisible et sans état
 * partagé à synchroniser.
 */

export type ToastData = {
  id: number;
  message: string;
  icon?: IconName;
};

type Listener = (toast: ToastData) => void;

let nextId = 1;
const listeners = new Set<Listener>();

/** Affiche un toast (~2,5 s). Un nouvel appel remplace le toast courant. */
export function showToast(message: string, icon?: IconName): void {
  const toast: ToastData = { id: nextId++, message, icon };
  for (const listener of listeners) {
    listener(toast);
  }
}

const VISIBLE_MS = 2500;

type ToastHostProps = {
  /**
   * `root` : posé au-dessus du chrome bas mesuré (tab bar + mini-player).
   * `modal` : posé au-dessus de l'inset système seulement (les modaux couvrent le chrome).
   */
  variant?: 'root' | 'modal';
};

export function ToastHost({ variant = 'root' }: ToastHostProps) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastData | null>(null);
  const [chromeHeight, setChromeHeight] = useState(() => getBottomChromeHeight());
  const [visible] = useState(() => new Animated.Value(0));
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeBottomChromeHeight(setChromeHeight), []);

  useEffect(() => {
    const unsubscribe = (() => {
      const listener: Listener = (next) => {
        setToast(next);
        Animated.spring(visible, {
          toValue: 1,
          useNativeDriver: true,
          speed: 18,
          bounciness: 5,
        }).start();
        if (hideTimer.current) {
          clearTimeout(hideTimer.current);
        }
        hideTimer.current = setTimeout(() => {
          Animated.timing(visible, { toValue: 0, duration: 180, useNativeDriver: true }).start(
            ({ finished }) => {
              if (finished) {
                setToast(null);
              }
            }
          );
        }, VISIBLE_MS);
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    })();
    return () => {
      unsubscribe();
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, [visible]);

  if (!toast) {
    return null;
  }

  const bottom =
    variant === 'root'
      ? Math.max(chromeHeight, insets.bottom) + spacing.md
      : insets.bottom + spacing.xxl;

  return (
    <View pointerEvents="none" style={[styles.layer, { bottom }]}>
      <Animated.View
        style={[
          styles.toast,
          {
            opacity: visible,
            transform: [
              { translateY: visible.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          },
        ]}
        accessibilityLiveRegion="polite"
      >
        {toast.icon && <Icon name={toast.icon} size={18} color={colors.accentIcon} />}
        <Text style={styles.message} numberOfLines={2}>
          {toast.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    // Élévation : le toast se détache du contenu, comme le mini-player.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  message: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 13.5,
    flexShrink: 1,
  },
});

export default ToastHost;
