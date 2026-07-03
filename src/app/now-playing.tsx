import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { colors, coverFallback, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/** Formate une durée (secondes) en `m:ss`. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/** Écran Lecture, présenté en modal. Branché sur le lecteur réel. */
export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { track, isPlaying, position, duration } = usePlayback();
  const { togglePlayPause, skipToNext, skipToPrevious, seekTo } = usePlayer();

  const [barWidth, setBarWidth] = useState(0);
  // Fraction visée pendant un glissement (scrubbing). `null` = pas de glissement en cours :
  // on suit alors la position réelle du lecteur. Pendant le geste, on n'appelle `seekTo`
  // qu'au lâcher pour ne pas bombarder le lecteur de sauts à chaque frame.
  const [scrubFraction, setScrubFraction] = useState<number | null>(null);

  // Le PanResponder n'est créé qu'une fois ; il lit largeur/durée/callback via une ref mise à
  // jour hors rendu (effet), pour ne pas recréer le responder en plein geste et éviter des
  // closures périmées quand la piste (durée) change.
  const seekRef = useRef({ barWidth, duration, seekTo });
  useEffect(() => {
    seekRef.current = { barWidth, duration, seekTo };
  });

  const fractionAt = (locationX: number): number => {
    const { barWidth: width } = seekRef.current;
    if (width <= 0) {
      return 0;
    }
    return Math.min(1, Math.max(0, locationX / width));
  };

  // Barre de progression déplaçable : tap OU glissement (le knob suit le doigt, seek au lâcher).
  // `PanResponder` du cœur RN, comme la file (reanimated/gesture-handler non configurés, cf. CLAUDE.md).
  // `seekRef` n'est lue que dans les handlers de geste (jamais pendant le rendu) : la règle
  // react-hooks/refs donne un faux positif sur la capture par useMemo.
  /* eslint-disable react-hooks/refs */
  const seekResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => setScrubFraction(fractionAt(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => setScrubFraction(fractionAt(e.nativeEvent.locationX)),
        onPanResponderRelease: (e) => {
          const fraction = fractionAt(e.nativeEvent.locationX);
          const { duration: dur, seekTo: seek } = seekRef.current;
          if (dur > 0) {
            seek(fraction * dur);
          }
          setScrubFraction(null);
        },
        onPanResponderTerminate: () => setScrubFraction(null),
      }),
    []
  );
  /* eslint-enable react-hooks/refs */

  const scrubbing = scrubFraction !== null;
  const liveProgress = duration > 0 ? Math.min(1, position / duration) : 0;
  // Pendant un glissement, l'affichage suit le doigt ; sinon, la lecture réelle.
  const progress = scrubFraction ?? liveProgress;
  const displayPosition = scrubbing ? progress * duration : position;
  const remaining = duration > 0 ? Math.max(0, duration - displayPosition) : 0;
  const title = track?.title ?? 'Aucune lecture';
  const artist = track?.artist ?? '—';
  const artwork = typeof track?.artwork === 'string' ? track.artwork : null;

  return (
    <View
      style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom }]}
    >
      {/* Barre supérieure : fermer + menu */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Fermer la lecture"
        >
          <Icon name="expand_more" size={28} color={colors.textPrimary} />
        </Pressable>
        <Icon name="more_horiz" size={24} color={colors.textPrimary} />
      </View>

      {/* Pochette */}
      <View style={styles.coverWrap}>
        {artwork ? (
          <Image source={{ uri: artwork }} style={styles.cover} contentFit="cover" />
        ) : (
          <View style={styles.cover} />
        )}
      </View>

      {/* Titre / artiste */}
      <View style={styles.metaBlock}>
        <Text style={styles.eyebrow}>En lecture</Text>
        <View style={styles.metaRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {artist}
            </Text>
          </View>
          <Icon name="favorite_border" size={26} color={colors.accentIcon} />
        </View>
      </View>

      {/* Progression (tap ou glissement pour se déplacer) */}
      <View style={styles.progressBlock}>
        <View
          {...seekResponder.panHandlers}
          onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
          hitSlop={12}
          accessibilityRole="adjustable"
          accessibilityLabel="Position de lecture"
        >
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            <View
              style={[
                styles.progressKnob,
                scrubbing && styles.progressKnobActive,
                { left: `${progress * 100}%` },
              ]}
            />
          </View>
        </View>
        <View style={styles.times}>
          <Text style={styles.time}>{formatTime(displayPosition)}</Text>
          <Text style={styles.time}>-{formatTime(remaining)}</Text>
        </View>
      </View>

      {/* Contrôles */}
      <View style={styles.controls}>
        <Icon name="shuffle" size={23} color={colors.textSecondary} />
        <Pressable
          onPress={skipToPrevious}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Piste précédente"
        >
          <Icon name="skip_previous" size={34} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          onPress={() => void togglePlayPause()}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'}
        >
          <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={36} color={colors.onAccent} />
        </Pressable>
        <Pressable
          onPress={skipToNext}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Piste suivante"
        >
          <Icon name="skip_next" size={34} color={colors.textPrimary} />
        </Pressable>
        <Icon name="repeat" size={23} color={colors.textSecondary} />
      </View>

      {/* Actions secondaires */}
      <View style={styles.secondary}>
        <Icon name="lyrics" size={22} color={colors.textSecondary} />
        <Pressable
          onPress={() => router.push('/queue')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir la file d'attente"
        >
          <Icon name="queue_music" size={22} color={colors.textSecondary} />
        </Pressable>
        <Icon name="cast" size={22} color={colors.textSecondary} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
  },
  coverWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  cover: {
    width: 300,
    height: 300,
    maxWidth: '80%',
    aspectRatio: 1,
    borderRadius: radii.lg,
    backgroundColor: coverFallback,
  },
  metaBlock: {
    paddingHorizontal: spacing.xxl,
  },
  eyebrow: {
    ...typography.label,
    fontSize: 10.5,
    letterSpacing: 1.6,
    color: colors.accentLabel,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: spacing.md,
  },
  trackTitle: {
    fontFamily: typography.display.fontFamily,
    fontSize: 29,
    letterSpacing: -0.3,
    color: colors.textPrimary,
  },
  artist: {
    ...typography.body,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  progressBlock: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.borderStrong,
    justifyContent: 'center',
    // Marge verticale pour agrandir la zone tactile sans épaissir le trait.
    marginVertical: spacing.sm,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    backgroundColor: colors.accent,
  },
  progressKnob: {
    position: 'absolute',
    width: 11,
    height: 11,
    marginLeft: -5.5,
    backgroundColor: colors.accent,
  },
  // Pendant le glissement : knob agrandi pour un retour tactile clair (marge ajustée pour rester centré).
  progressKnobActive: {
    width: 15,
    height: 15,
    marginLeft: -7.5,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  time: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
    paddingTop: spacing.xxl,
  },
  playButton: {
    width: 68,
    height: 68,
    borderRadius: radii.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 46,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
});
