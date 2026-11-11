import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, spacing, typography } from '@/theme';
import { selection as hapticSelection } from '@/lib/haptics';
import { SPRING_BOUNCY } from '@/lib/motion';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlaybackProgress } from '@/player/usePlayback';

/** Formate une durée (secondes) en `m:ss`. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/** Écart (s) sous lequel la position réelle est considérée comme ayant rejoint un seek. */
const SEEK_SETTLED = 1.5;
/** Délai au-delà duquel on cesse d'attendre la confirmation d'un seek. */
const SEEK_TIMEOUT_MS = 2500;

/**
 * Barre de lecture de l'écran Lecture : on la touche ou on la glisse pour se déplacer dans le
 * morceau.
 *
 * Le doigt est suivi sur le thread d'interface : le remplissage et le curseur bougent sans
 * attendre le JS, et le curseur grossit tant qu'on le tient. Le déplacement réel n'est demandé
 * qu'au lâcher, pour ne pas bombarder le lecteur. Après le lâcher, la barre reste sur la cible le
 * temps que le lecteur confirme (sa position n'est sondée que deux fois par seconde) : sans ça,
 * elle repartirait brièvement en arrière avant de sauter.
 *
 * Isolée dans son composant : c'est le seul élément de l'écran qui re-rend au rythme de la
 * progression.
 */
export function SeekBar() {
  const { seekTo } = usePlayer();
  const { position, duration } = usePlaybackProgress(0.5);

  const width = useSharedValue(0);
  const progress = useSharedValue(duration > 0 ? position / duration : 0);
  const scrubbing = useSharedValue(false);
  // Position affichée pendant un glissement (secondes), `null` sinon.
  const [scrubSeconds, setScrubSeconds] = useState<number | null>(null);
  // Durée lue par le geste, et cible d'un seek demandé mais pas encore confirmé (-1 = aucune).
  const durationValue = useSharedValue(duration);
  const pendingTarget = useSharedValue(-1);

  useEffect(() => {
    durationValue.set(duration);
  }, [duration, durationValue]);

  // La position sondée pilote la barre, sauf pendant un glissement ou en attente d'un seek.
  useEffect(() => {
    if (scrubbing.get()) {
      return;
    }
    const target = pendingTarget.get();
    if (target >= 0) {
      if (Math.abs(position - target) > SEEK_SETTLED) {
        return;
      }
      pendingTarget.set(-1);
    }
    const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
    const jump = Math.abs(ratio - progress.get()) > 0.02;
    progress.set(
      withTiming(ratio, jump ? { duration: 160 } : { duration: 500, easing: Easing.linear })
    );
  }, [position, duration, progress, scrubbing, pendingTarget]);

  const commit = (target: number) => {
    pendingTarget.set(target);
    seekTo(target);
    setScrubSeconds(null);
    // Filet : si le lecteur ne confirme jamais, la barre se remet à suivre la position réelle.
    setTimeout(() => {
      if (pendingTarget.get() === target) {
        pendingTarget.set(-1);
      }
    }, SEEK_TIMEOUT_MS);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      const ratio = Math.min(1, Math.max(0, e.x / (width.get() || 1)));
      scrubbing.set(true);
      progress.set(ratio);
      scheduleOnRN(hapticSelection);
      scheduleOnRN(setScrubSeconds, ratio * durationValue.get());
    })
    .onChange((e) => {
      const ratio = Math.min(1, Math.max(0, e.x / (width.get() || 1)));
      progress.set(ratio);
      scheduleOnRN(setScrubSeconds, ratio * durationValue.get());
    })
    .onFinalize(() => {
      if (!scrubbing.get()) {
        return;
      }
      scrubbing.set(false);
      scheduleOnRN(commit, progress.get() * durationValue.get());
    });

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.get() }],
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.get() * width.get() - KNOB / 2 },
      { scale: withSpring(scrubbing.get() ? 1.6 : 1, SPRING_BOUNCY) },
    ],
  }));

  const shown = scrubSeconds ?? position;
  const remaining = duration > 0 ? Math.max(0, duration - shown) : 0;

  return (
    <View>
      <GestureDetector gesture={pan}>
        <View
          style={styles.hitArea}
          onLayout={(e) => width.set(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Position de lecture"
          accessibilityValue={{ text: `${formatTime(shown)} sur ${formatTime(duration)}` }}
        >
          <View style={styles.track}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
          <Animated.View style={[styles.knob, knobStyle]} />
        </View>
      </GestureDetector>
      <View style={styles.times}>
        <Text style={[styles.time, scrubSeconds !== null && styles.timeActive]}>
          {formatTime(shown)}
        </Text>
        <Text style={styles.time}>-{formatTime(remaining)}</Text>
      </View>
    </View>
  );
}

const KNOB = 12;

const styles = StyleSheet.create({
  // Zone tactile haute pour un trait fin : on attrape la barre sans viser au pixel près.
  hitArea: {
    height: 28,
    justifyContent: 'center',
  },
  track: {
    height: 3,
    backgroundColor: colors.borderStrong,
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    backgroundColor: colors.accent,
    transformOrigin: 'left',
  },
  knob: {
    position: 'absolute',
    left: 0,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: colors.accent,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  time: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  timeActive: {
    color: colors.accentLabel,
  },
});

export default SeekBar;
