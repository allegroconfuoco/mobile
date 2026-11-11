import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useIsPlaying, type MediaItem } from '@rntp/player';

import { colors, spacing, typography } from '@/theme';
import { HeartButton } from '@/components/HeartButton';
import { Icon } from '@/components/Icon';
import { PlayPauseIcon } from '@/components/PlayPauseIcon';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { PressableScale } from '@/components/PressableScale';
import { CarouselPageView, useTrackCarousel } from '@/components/TrackCarousel';
import { TrackCover } from '@/components/TrackCover';
import { tapLight } from '@/lib/haptics';
import { DURATION, EASE_OUT, SPRING_SNAPPY } from '@/lib/motion';
import { useRouter } from '@/lib/useRouter';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { useActiveTrack, usePlaybackProgress } from '@/player/usePlayback';

/** Hauteur de la rangée du mini-lecteur (pochette 44 + marges), hors barre de progression. */
const ROW_HEIGHT = 64;
/** Déplacement vers le haut (px) qui ouvre l'écran Lecture. */
const OPEN_DISTANCE = 28;

/**
 * Mini-lecteur persistant, posé au-dessus de la barre d'onglets.
 *
 * - **Glisser à l'horizontale** change de piste : la pochette et le titre partent en entier sous
 *   le doigt pendant que ceux de la piste voisine entrent à leur place (cf. `TrackCarousel`).
 * - **Tap** ou **glisser vers le haut** ouvre l'écran Lecture ; **appui long** ouvre la file.
 * - À droite, trois boutons qui ne bougent pas pendant le glissement : cœur, « + » (ajouter le
 *   titre en cours à une playlist) et lecture / pause.
 *
 * Se cache tant qu'aucune piste n'est chargée. Au lancement, il affiche la dernière session
 * d'écoute, à l'arrêt : un tap sur lecture la reprend là où elle s'était arrêtée.
 */
export function MiniPlayer() {
  const router = useRouter();
  // Pas de `usePlayback` ici : son sondage de position re-rendrait toute la barre 4×/s. La
  // progression vit dans `MiniProgressBar`, seul composant qui sonde.
  const track = useActiveTrack();
  const isPlaying = useIsPlaying();
  const { togglePlayPause } = usePlayer();
  const { tracksById } = useLibrary();
  const carousel = useTrackCarousel();

  // Piste locale correspondant à la piste active (cœur et « + ») ; absente si le fichier a disparu.
  const local = track?.mediaId ? (tracksById.get(track.mediaId) ?? null) : null;
  const [pickerTrack, setPickerTrack] = useState<LocalTrack | null>(null);

  const openPlayer = () => router.push('/now-playing');
  const openQueue = () => {
    tapLight();
    router.push('/queue');
  };

  // Glisser vers le haut : la barre se soulève sous le doigt, puis l'écran Lecture s'ouvre.
  const lift = useSharedValue(0);
  const open = Gesture.Pan()
    .activeOffsetY(-12)
    .failOffsetY(12)
    .failOffsetX([-14, 14])
    .onChange((e) => {
      lift.set(Math.max(-OPEN_DISTANCE, Math.min(0, e.translationY * 0.5)));
    })
    .onEnd((e) => {
      if (e.translationY < -OPEN_DISTANCE || e.velocityY < -600) {
        scheduleOnRN(openPlayer);
      }
    })
    .onFinalize(() => {
      lift.set(withSpring(0, SPRING_SNAPPY));
    });
  const gestures = Gesture.Race(carousel.gesture, open);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));

  // Rien à afficher tant que la file est vide. (Hooks appelés avant ce retour : règles respectées.)
  if (!track) {
    return null;
  }

  return (
    <Animated.View entering={FadeInDown.duration(DURATION.slow).easing(EASE_OUT)}>
      <Animated.View style={[styles.container, liftStyle]}>
        <MiniProgressBar />

        <View style={styles.row}>
          <GestureDetector gesture={gestures}>
            <View style={styles.carousel} onLayout={carousel.onLayout}>
              {carousel.pages.map((page) => (
                <CarouselPageView key={page.slot} slot={page.slot} carousel={carousel}>
                  <TrackPage
                    item={page.item}
                    // Seule la page courante est interactive et lue par le lecteur d'écran.
                    interactive={page.current}
                    onPress={openPlayer}
                    onLongPress={openQueue}
                  />
                </CarouselPageView>
              ))}
            </View>
          </GestureDetector>

          {local && <HeartButton trackId={local.id} style={styles.button} toast />}
          {local && (
            <Pressable
              onPress={() => {
                tapLight();
                setPickerTrack(local);
              }}
              hitSlop={4}
              android_ripple={{ color: colors.borderStrong, borderless: true, radius: 20 }}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel="Ajouter le titre en cours à une playlist"
            >
              <Icon name="add" size={24} color={colors.textSecondary} />
            </Pressable>
          )}
          <PressableScale
            onPress={() => {
              tapLight();
              togglePlayPause();
            }}
            hitSlop={4}
            style={styles.playButton}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'}
          >
            <PlayPauseIcon playing={isPlaying} size={30} color={colors.accentIcon} />
          </PressableScale>
        </View>
      </Animated.View>

      <PlaylistPickerSheet
        tracks={pickerTrack ? [pickerTrack] : null}
        onClose={() => setPickerTrack(null)}
      />
    </Animated.View>
  );
}

/** Contenu d'une page du carrousel : pochette, titre, artiste. */
function TrackPage({
  item,
  interactive,
  onPress,
  onLongPress,
}: {
  item: MediaItem;
  interactive: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const title = item.title ?? 'Titre inconnu';
  const artist = item.artist ?? 'Artiste inconnu';
  return (
    <Pressable
      onPress={interactive ? onPress : undefined}
      onLongPress={interactive ? onLongPress : undefined}
      delayLongPress={300}
      style={styles.page}
      accessible={interactive}
      importantForAccessibility={interactive ? 'yes' : 'no-hide-descendants'}
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir la lecture en cours : ${title}, ${artist}`}
      accessibilityHint="Glissez à l'horizontale pour changer de piste. Appui long pour la file d'attente."
    >
      <TrackCover
        uri={typeof item.artworkUrl === 'string' ? item.artworkUrl : null}
        seed={`${title}${typeof item.artist === 'string' ? item.artist : ''}`}
      />
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {artist}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Barre de progression fine, isolée : seul composant du mini-lecteur à sonder la position. Le
 * remplissage est une mise à l'échelle animée d'un tick au suivant, donc il avance en continu
 * au lieu de sauter deux fois par seconde.
 */
function MiniProgressBar() {
  const { position, duration } = usePlaybackProgress(0.5);
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const progress = useSharedValue(ratio);

  useEffect(() => {
    // Un grand écart (changement de piste, seek) se rattrape vite ; l'avancée normale est lissée
    // sur la durée d'un tick, à vitesse constante.
    const jump = Math.abs(ratio - progress.get()) > 0.02;
    progress.set(
      withTiming(ratio, jump ? { duration: 160 } : { duration: 500, easing: Easing.linear })
    );
  }, [ratio, progress]);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  progressTrack: {
    height: 2,
    backgroundColor: colors.border,
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.accent,
    transformOrigin: 'left',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingRight: spacing.md,
  },
  // Fenêtre du carrousel : borne les pages et masque celles des pistes voisines.
  carousel: {
    flex: 1,
    height: ROW_HEIGHT,
    overflow: 'hidden',
  },
  page: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.heading,
    fontSize: 13.5,
  },
  artist: {
    ...typography.body,
    fontSize: 11.5,
    marginTop: 1,
  },
  button: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MiniPlayer;
