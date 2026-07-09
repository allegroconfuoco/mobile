import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Animated,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { RepeatMode } from 'react-native-track-player';

import { colors, coverFallback, coverGradient, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { ToastHost, showToast } from '@/components/Toast';
import { PressableScale } from '@/components/PressableScale';
import { TrackActionsSheet } from '@/components/TrackActionsSheet';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { usePlayer, usePlaybackMode } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';
import { useLibrary } from '@/library/LibraryProvider';
import { useFavorites } from '@/library/FavoritesProvider';
import { confirmRestoreTags } from '@/library/writeTags';
import * as db from '@/library/db';
import { tapLight, tapMedium } from '@/lib/haptics';

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
  const { togglePlayPause, skipToNext, skipToPrevious, seekTo, playNext, addToQueue } = usePlayer();
  const { repeatMode, shuffle, cycleRepeat, toggleShuffle } = usePlaybackMode();
  const { tracksById, setTrackExcluded, reloadTracks } = useLibrary();
  const { isFavorite, toggleFavorite } = useFavorites();

  // Piste locale correspondant à la lecture en cours (pour favori + menu d'actions).
  const local = track ? (tracksById.get(String(track.id)) ?? null) : null;
  const liked = local ? isFavorite(local.id) : false;

  // Menu « … » (réutilise le bottom sheet d'actions de la bibliothèque) + sélecteur de playlist.
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // Entrée de l'écran : léger fondu + montée (motion design, API Animated du cœur RN).
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
  }, [enter]);

  // Glissement vers le bas pour fermer (comme un vrai lecteur musical). La pochette sert de
  // poignée de glissement (grande zone non interactive) ; `PanResponder` du cœur RN, cf. CLAUDE.md.
  const [dragY] = useState(() => new Animated.Value(0));
  const dismissResponder = useMemo(
    () =>
      PanResponder.create({
        // On ne prend le geste que pour un glissement franchement vertical vers le bas,
        // pour ne pas gêner un tap sur la pochette.
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && g.dy > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) {
            dragY.setValue(g.dy);
          }
        },
        onPanResponderRelease: (_e, g) => {
          // Assez loin OU geste rapide vers le bas → on ferme ; sinon retour en place.
          if (g.dy > 120 || g.vy > 0.6) {
            router.back();
          } else {
            Animated.spring(dragY, {
              toValue: 0,
              useNativeDriver: true,
              speed: 18,
              bounciness: 6,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            speed: 18,
            bounciness: 6,
          }).start();
        },
      }),
    [dragY, router]
  );

  // La pochette « respire » : légèrement agrandie en lecture, resserrée en pause (repère d'état).
  const [coverScale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    Animated.spring(coverScale, {
      toValue: isPlaying ? 1 : 0.965,
      useNativeDriver: true,
      speed: 12,
      bounciness: 6,
    }).start();
  }, [isPlaying, coverScale]);

  // « Pop » du coeur au like/unlike.
  const [heartScale] = useState(() => new Animated.Value(1));
  const onToggleFavorite = () => {
    if (!local) {
      return;
    }
    tapMedium();
    toggleFavorite(local.id, local.mbid);
    heartScale.setValue(0.8);
    Animated.spring(heartScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 14,
      bounciness: 16,
    }).start();
  };

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

  // Répétition : couleur active hors « Off », icône « une piste » en mode Track.
  const repeatActive = repeatMode !== RepeatMode.Off;
  const repeatIcon = repeatMode === RepeatMode.Track ? 'repeat_one' : 'repeat';
  const repeatLabel =
    repeatMode === RepeatMode.Off
      ? 'Répétition désactivée'
      : repeatMode === RepeatMode.Track
        ? 'Répéter la piste'
        : 'Répéter la file';

  return (
    <Animated.View
      style={[
        styles.screen,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom },
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            { translateY: dragY },
          ],
        },
      ]}
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
        <Pressable
          onPress={() => {
            if (local) {
              tapLight();
              setMenuOpen(true);
            }
          }}
          disabled={!local}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Plus d'actions"
        >
          <Icon name="more_horiz" size={24} color={local ? colors.textPrimary : colors.textMuted} />
        </Pressable>
      </View>

      {/* Pochette (sert aussi de poignée : glisser vers le bas ferme la lecture) */}
      <View style={styles.coverWrap} {...dismissResponder.panHandlers}>
        <Animated.View style={[styles.coverShadow, { transform: [{ scale: coverScale }] }]}>
          {artwork ? (
            <Image source={{ uri: artwork }} style={styles.cover} contentFit="cover" />
          ) : (
            <LinearGradient
              colors={coverGradient(`${title}${artist}`) as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cover}
            />
          )}
        </Animated.View>
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
          <Pressable
            onPress={onToggleFavorite}
            disabled={!local}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={liked ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Icon
                name={liked ? 'favorite' : 'favorite_border'}
                filled={liked}
                size={26}
                color={!local ? colors.textMuted : liked ? colors.accent : colors.textSecondary}
              />
            </Animated.View>
          </Pressable>
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
        <Pressable
          onPress={() => {
            tapMedium();
            toggleShuffle();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={shuffle ? 'Désactiver la lecture aléatoire' : 'Lecture aléatoire'}
        >
          <Icon name="shuffle" size={23} color={shuffle ? colors.accent : colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={() => {
            tapLight();
            skipToPrevious();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Piste précédente"
        >
          <Icon name="skip_previous" size={34} color={colors.textPrimary} />
        </Pressable>
        <PressableScale
          onPress={() => {
            tapLight();
            void togglePlayPause();
          }}
          style={styles.playButton}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'}
        >
          <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={36} color={colors.onAccent} />
        </PressableScale>
        <Pressable
          onPress={() => {
            tapLight();
            skipToNext();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Piste suivante"
        >
          <Icon name="skip_next" size={34} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          onPress={() => {
            tapMedium();
            cycleRepeat();
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={repeatLabel}
        >
          <Icon
            name={repeatIcon}
            size={23}
            color={repeatActive ? colors.accent : colors.textSecondary}
          />
        </Pressable>
      </View>

      {/* Actions secondaires : la file d'attente. */}
      <View style={styles.secondary}>
        <Pressable
          onPress={() => router.push('/queue')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir la file d'attente"
        >
          <Icon name="queue_music" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Menu d'actions sur la piste en cours (réutilisé de la bibliothèque). */}
      <TrackActionsSheet
        title={menuOpen ? (local?.title ?? title) : null}
        isFavorite={liked}
        onClose={() => setMenuOpen(false)}
        onPlayNext={() => {
          if (local) {
            void playNext([local]);
            showToast('Lira ensuite', 'queue_music');
          }
        }}
        onAddToQueue={() => {
          if (local) {
            void addToQueue([local]);
            showToast('Ajouté à la file', 'queue_music');
          }
        }}
        onToggleFavorite={onToggleFavorite}
        onAddToPlaylist={() => setPickerOpen(true)}
        onFixMetadata={() =>
          local && router.push({ pathname: '/metadata-fix', params: { trackId: local.id } })
        }
        onLinkAlbum={() =>
          local && router.push({ pathname: '/identify-album', params: { trackId: local.id } })
        }
        onWriteToFile={() =>
          local && router.push({ pathname: '/write-tags', params: { trackId: local.id } })
        }
        onRestoreFile={() => local && confirmRestoreTags(local, reloadTracks)}
        hasFileBackup={local ? db.hasTagBackup(local.id) : false}
        onExclude={() => local && setTrackExcluded(local.id, true)}
      />

      <PlaylistPickerSheet track={pickerOpen ? local : null} onClose={() => setPickerOpen(false)} />

      {/* Modal natif : le host racine ne passe pas au-dessus, on monte le nôtre (cf. Toast.tsx). */}
      <ToastHost variant="modal" />
    </Animated.View>
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
  // Ombre portée sous la pochette (élévation Android + shadow iOS), sur le conteneur animé.
  coverShadow: {
    width: 300,
    maxWidth: '80%',
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
