import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Extrapolation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { RepeatMode, useIsPlaying, type MediaItem } from '@rntp/player';

import { colors, coverFallback, coverGradient, radii, spacing, typography } from '@/theme';
import { BottomSheet } from '@/components/BottomSheet';
import { HeartButton } from '@/components/HeartButton';
import { Icon, type IconName } from '@/components/Icon';
import { PlayPauseIcon } from '@/components/PlayPauseIcon';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { PressableScale } from '@/components/PressableScale';
import { QuickActionsSheet, type QuickAction } from '@/components/QuickActionsSheet';
import { SeekBar } from '@/components/SeekBar';
import { ToastHost, showToast } from '@/components/Toast';
import { CarouselPageView, useTrackCarousel } from '@/components/TrackCarousel';
import { tapLight, tapMedium } from '@/lib/haptics';
import { DURATION, EASE_IN, SPRING_SNAPPY, useSpringFlag } from '@/lib/motion';
import { useRouter } from '@/lib/useRouter';
import { artistPagesForTrack } from '@/library/artists';
import { albumArtistOf, albumOf, UNKNOWN_ALBUM } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlaybackMode, usePlayer, useQueue } from '@/player/PlayerProvider';
import { getQueueSource, type QueueSource } from '@/player/queueSource';
import { neighborIndex, useActiveTrack } from '@/player/usePlayback';
import { useSleepTimer, type SleepTimerInfo } from '@/player/useSleepTimer';

/** Distance (px) ou vitesse (px/s) vers le bas qui ferme l'écran. */
const CLOSE_DISTANCE = 140;
const CLOSE_VELOCITY = 900;

/** Libellé court du minuteur (compte à rebours ou fin de piste), ou `null` si inactif. */
function sleepTimerLabel(timer: SleepTimerInfo | null): string | null {
  if (timer?.type === 'time') {
    return `${Math.max(1, Math.ceil(timer.remainingSeconds / 60))} min`;
  }
  if (timer?.type === 'mediaItem') {
    return 'fin de piste';
  }
  return null;
}

/** Libellé « Lecture depuis … » de la source de la file. */
function sourceLabel(source: QueueSource | null): string | null {
  switch (source?.kind) {
    case 'playlist':
      return source.name;
    case 'album':
      return source.title;
    case 'artist':
      return source.name;
    case 'favorites':
      return 'Favoris';
    case 'recent':
      return 'Récemment ajoutés';
    default:
      return null;
  }
}

/**
 * Écran Lecture, présenté par-dessus l'app (qui reste visible derrière).
 *
 * - **Pochette** : glisser à l'horizontale change de piste, la pochette suivante entrant sous le
 *   doigt ; glisser vers le bas fait descendre tout l'écran et le ferme, l'app réapparaissant
 *   dessous. La pochette se resserre légèrement en pause.
 * - **Titre** : le toucher propose d'aller à l'album, à l'artiste ou à la playlist d'où vient la
 *   lecture.
 * - **Cœur** et **+** à côté du titre, contrôles de lecture, puis minuteur, « À suivre » et file.
 */
export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const track = useActiveTrack();
  const isPlaying = useIsPlaying();
  const queue = useQueue();
  const { togglePlayPause, skipToNext, skipToPrevious } = usePlayer();
  const { repeatMode, shuffle, cycleRepeat, toggleShuffle } = usePlaybackMode();
  const { tracks, tracksById } = useLibrary();
  const { playlists } = usePlaylistsContext();
  const carousel = useTrackCarousel();

  const local = track?.mediaId ? (tracksById.get(track.mediaId) ?? null) : null;
  const [pickerTrack, setPickerTrack] = useState<LocalTrack | null>(null);
  const [goToOpen, setGoToOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const {
    timer: sleepTimer,
    startAfterMinutes,
    stopAtEndOfTrack,
    cancel: cancelSleepTimer,
  } = useSleepTimer();

  const nextIndex = neighborIndex(queue, repeatMode, 1);
  const upNext = nextIndex != null ? queue.tracks[nextIndex] : null;
  const source = getQueueSource();
  const fromLabel = sourceLabel(source);

  // --- Glisser vers le bas pour fermer --------------------------------------------------------
  const dragY = useSharedValue(0);
  const close = () => router.back();
  const closeGesture = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-16, 16])
    .onChange((e) => {
      dragY.set(Math.max(0, e.translationY));
    })
    .onEnd((e) => {
      if (e.translationY > CLOSE_DISTANCE || e.velocityY > CLOSE_VELOCITY) {
        // L'écran finit sa descente lui-même, puis on le retire : la navigation n'a plus rien de
        // visible à animer.
        dragY.set(
          withTiming(screenHeight, { duration: DURATION.base, easing: EASE_IN }, (done) => {
            if (done) {
              scheduleOnRN(close);
            }
          })
        );
      } else {
        dragY.set(withSpring(0, { ...SPRING_SNAPPY, velocity: e.velocityY }));
      }
    });
  const coverGestures = Gesture.Race(carousel.gesture, closeGesture);

  const screenStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.get() }],
    borderTopLeftRadius: interpolate(dragY.get(), [0, 80], [0, radii.lg], Extrapolation.CLAMP),
    borderTopRightRadius: interpolate(dragY.get(), [0, 80], [0, radii.lg], Extrapolation.CLAMP),
  }));
  // La pochette se resserre en pause : l'état de lecture se lit d'un coup d'œil.
  const playingFlag = useSpringFlag(isPlaying);
  const coverStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.9 + 0.1 * playingFlag.get() }],
  }));

  // --- « Aller à » ----------------------------------------------------------------------------
  const goTo = useMemo<QuickAction[]>(() => {
    if (!local) {
      return [];
    }
    // On quitte la lecture puis on ouvre l'écran demandé dans l'app, sous la barre d'onglets.
    const open = (href: Parameters<typeof router.push>[0]) => {
      router.back();
      router.push(href);
    };
    const out: QuickAction[] = [];
    if (source?.kind === 'playlist' && playlists.some((p) => p.id === source.id)) {
      out.push({
        icon: 'queue_music',
        label: `Playlist « ${source.name} »`,
        onPress: () => open({ pathname: '/playlist', params: { id: source.id } }),
      });
    }
    if (source?.kind === 'favorites') {
      out.push({ icon: 'favorite', label: 'Favoris', onPress: () => open('/favorites') });
    }
    if (source?.kind === 'recent') {
      out.push({ icon: 'history', label: 'Récemment ajoutés', onPress: () => open('/recent') });
    }
    const album = albumOf(local);
    if (album !== UNKNOWN_ALBUM) {
      out.push({
        icon: 'album',
        label: `Album « ${album} »`,
        onPress: () =>
          open({ pathname: '/album', params: { artist: albumArtistOf(local), title: album } }),
      });
    }
    for (const name of artistPagesForTrack(tracks, local)) {
      out.push({
        icon: 'person',
        label: name,
        onPress: () => open({ pathname: '/artist', params: { name } }),
      });
    }
    return out;
  }, [local, source, playlists, tracks, router]);

  const repeatIcon: IconName = repeatMode === RepeatMode.One ? 'repeat_one' : 'repeat';
  const repeatLabel =
    repeatMode === RepeatMode.Off
      ? 'Répétition désactivée'
      : repeatMode === RepeatMode.One
        ? 'Répéter la piste'
        : 'Répéter la file';

  return (
    <Animated.View
      style={[
        styles.screen,
        { paddingTop: insets.top + spacing.xs, paddingBottom: insets.bottom + spacing.sm },
        screenStyle,
      ]}
    >
      <View style={styles.topBar}>
        <IconButton icon="expand_more" size={30} label="Fermer la lecture" onPress={close} />
        <View style={styles.topCenter}>
          <Text style={styles.eyebrow}>{fromLabel ? 'Lecture depuis' : 'En lecture'}</Text>
          {fromLabel && (
            <Text style={styles.from} numberOfLines={1}>
              {fromLabel}
            </Text>
          )}
        </View>
        <IconButton
          icon="queue_music"
          label="Ouvrir la file d'attente"
          onPress={() => router.push('/queue')}
        />
      </View>

      {/* Pochettes : carrousel horizontal + glisser vers le bas pour fermer. */}
      <GestureDetector gesture={coverGestures}>
        <View style={styles.coverArea} onLayout={carousel.onLayout}>
          {carousel.pages.map((page) => (
            <CarouselPageView key={page.slot} slot={page.slot} carousel={carousel}>
              <View style={styles.coverPage}>
                <Animated.View style={[styles.coverShadow, page.current && coverStyle]}>
                  <Artwork item={page.item} />
                </Animated.View>
              </View>
            </CarouselPageView>
          ))}
        </View>
      </GestureDetector>

      <View style={styles.metaRow}>
        <Pressable
          onPress={() => {
            if (goTo.length > 0) {
              tapLight();
              setGoToOpen(true);
            }
          }}
          style={styles.metaText}
          accessibilityRole="button"
          accessibilityLabel={`${track?.title ?? 'Aucune lecture'}, ${track?.artist ?? ''}`}
          accessibilityHint="Aller à l'album, à l'artiste ou à la playlist"
        >
          {/* Le titre change en fondu à chaque piste (clé = piste). */}
          <Animated.View
            key={track?.mediaId ?? 'none'}
            entering={FadeIn.duration(DURATION.base)}
            exiting={FadeOut.duration(DURATION.fast)}
          >
            <Text style={styles.title} numberOfLines={1}>
              {track?.title ?? 'Aucune lecture'}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {track?.artist ?? '—'}
            </Text>
          </Animated.View>
        </Pressable>
        {local && <HeartButton trackId={local.id} size={26} style={styles.metaButton} />}
        {local && (
          <IconButton
            icon="add"
            size={28}
            label="Ajouter à une playlist"
            onPress={() => setPickerTrack(local)}
          />
        )}
      </View>

      <View style={styles.seek}>
        <SeekBar />
      </View>

      <View style={styles.controls}>
        <IconButton
          icon="shuffle"
          size={24}
          color={shuffle ? colors.accent : colors.textSecondary}
          label={shuffle ? 'Désactiver la lecture aléatoire' : 'Lecture aléatoire'}
          onPress={() => {
            tapMedium();
            toggleShuffle();
          }}
        />
        <IconButton
          icon="skip_previous"
          size={38}
          label="Piste précédente"
          onPress={() => {
            tapLight();
            skipToPrevious();
          }}
        />
        <PressableScale
          onPress={() => {
            tapLight();
            togglePlayPause();
          }}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'}
        >
          <PlayPauseIcon playing={isPlaying} size={38} color={colors.onAccent} />
        </PressableScale>
        <IconButton
          icon="skip_next"
          size={38}
          label="Piste suivante"
          onPress={() => {
            tapLight();
            skipToNext();
          }}
        />
        <IconButton
          icon={repeatIcon}
          size={24}
          color={repeatMode !== RepeatMode.Off ? colors.accent : colors.textSecondary}
          label={repeatLabel}
          onPress={() => {
            tapMedium();
            cycleRepeat();
          }}
        />
      </View>

      <View style={styles.secondary}>
        <Pressable
          onPress={() => {
            tapLight();
            setTimerOpen(true);
          }}
          hitSlop={12}
          style={styles.timer}
          accessibilityRole="button"
          accessibilityLabel={
            sleepTimer === null
              ? 'Minuteur de sommeil'
              : `Minuteur de sommeil actif, ${sleepTimerLabel(sleepTimer)}`
          }
        >
          <Icon
            name="timer"
            size={22}
            color={sleepTimer === null ? colors.textSecondary : colors.accent}
          />
          {sleepTimer !== null && (
            <Text style={styles.timerLabel}>{sleepTimerLabel(sleepTimer)}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.push('/queue')}
          style={styles.upNext}
          accessibilityRole="button"
          accessibilityLabel={
            upNext
              ? `À suivre : ${upNext.title ?? 'Titre inconnu'}. Ouvrir la file.`
              : 'Ouvrir la file'
          }
        >
          {upNext && (
            <Animated.View
              key={upNext.mediaId}
              entering={FadeIn.duration(DURATION.base)}
              style={styles.upNextInner}
            >
              <Text style={styles.upNextLabel}>À suivre</Text>
              <Text style={styles.upNextTitle} numberOfLines={1}>
                {upNext.title ?? 'Titre inconnu'}
                {upNext.artist ? ` · ${upNext.artist}` : ''}
              </Text>
            </Animated.View>
          )}
        </Pressable>
      </View>

      <QuickActionsSheet
        visible={goToOpen}
        title="Aller à"
        actions={goTo}
        onClose={() => setGoToOpen(false)}
      />

      <PlaylistPickerSheet
        tracks={pickerTrack ? [pickerTrack] : null}
        onClose={() => setPickerTrack(null)}
      />

      <BottomSheet
        visible={timerOpen}
        onClose={() => setTimerOpen(false)}
        title="Minuteur de sommeil"
      >
        {[15, 30, 45, 60].map((minutes) => (
          <SheetRow
            key={minutes}
            icon="timer"
            label={`Dans ${minutes} minutes`}
            onPress={() => {
              startAfterMinutes(minutes);
              setTimerOpen(false);
              showToast(`Lecture coupée dans ${minutes} min`, 'timer');
            }}
          />
        ))}
        <SheetRow
          icon="music_off"
          label="À la fin de la piste"
          onPress={() => {
            stopAtEndOfTrack();
            setTimerOpen(false);
            showToast('Lecture coupée à la fin de la piste', 'timer');
          }}
        />
        {sleepTimer !== null && (
          <SheetRow
            icon="close"
            label="Désactiver"
            accent
            onPress={() => {
              cancelSleepTimer();
              setTimerOpen(false);
              showToast('Minuteur désactivé', 'timer');
            }}
          />
        )}
      </BottomSheet>

      {/* Toast propre à cet écran, posé au-dessus de son bas (cf. Toast.tsx). */}
      <ToastHost variant="modal" />
    </Animated.View>
  );
}

/** Pochette d'une page du carrousel : image du fichier, ou dégradé de repli. */
function Artwork({ item }: { item: MediaItem }) {
  const uri = typeof item.artworkUrl === 'string' ? item.artworkUrl : null;
  if (uri) {
    return <Image source={{ uri }} style={styles.cover} contentFit="cover" transition={150} />;
  }
  return (
    <LinearGradient
      colors={coverGradient(`${item.title ?? ''}${item.artist ?? ''}`) as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.cover, styles.coverFallback]}
    >
      <Icon name="music_note" size={72} color={colors.onAccent} />
    </LinearGradient>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  size = 26,
  color = colors.textPrimary,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={6}
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={size} color={color} />
    </PressableScale>
  );
}

function SheetRow({
  icon,
  label,
  onPress,
  accent = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        tapLight();
        onPress();
      }}
      android_ripple={{ color: colors.borderStrong }}
      style={styles.sheetRow}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={22} color={accent ? colors.accent : colors.textSecondary} />
      <Text style={[styles.sheetLabel, accent && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  topCenter: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  eyebrow: {
    ...typography.label,
    fontSize: 10,
    color: colors.textMuted,
  },
  from: {
    ...typography.heading,
    fontSize: 13,
    marginTop: 2,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverArea: {
    flex: 1,
    overflow: 'hidden',
  },
  coverPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  coverShadow: {
    width: '100%',
    maxWidth: 360,
    aspectRatio: 1,
    borderRadius: radii.lg,
    backgroundColor: coverFallback,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  cover: {
    width: '100%',
    height: '100%',
    borderRadius: radii.lg,
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.xxl,
    paddingRight: spacing.md,
    paddingTop: spacing.lg,
  },
  metaText: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  metaButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: typography.display.fontFamily,
    fontSize: 26,
    letterSpacing: -0.3,
    color: colors.textPrimary,
  },
  artist: {
    ...typography.body,
    fontSize: 15,
    marginTop: 2,
  },
  seek: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    minHeight: 64,
  },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 48,
  },
  timerLabel: {
    ...typography.body,
    fontSize: 11,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  upNext: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  upNextInner: {
    alignItems: 'flex-end',
    maxWidth: '100%',
  },
  upNextLabel: {
    ...typography.label,
    fontSize: 9.5,
    color: colors.textMuted,
  },
  upNextTitle: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
    borderRadius: radii.sm,
  },
  sheetLabel: {
    ...typography.heading,
    fontSize: 15,
  },
});
