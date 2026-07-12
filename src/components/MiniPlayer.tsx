import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/lib/useRouter';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, coverFallback, coverGradient, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';
import { tapLight } from '@/lib/haptics';

// Seuils de geste (px). Au-delà, on déclenche l'action ; en-deçà, retour à la position de repos.
const SWIPE_DISTANCE = 60; // horizontal → piste précédente / suivante
const OPEN_DISTANCE = 36; // vertical vers le haut → ouvre la lecture

/**
 * Mini-player persistant, posé au-dessus de la tab bar.
 *
 * Se cache tant qu'aucune piste n'est chargée. Un tap sur la barre ouvre l'écran Lecture
 * (modal « now-playing ») ; le bouton play/pause, lui, pilote la lecture sans ouvrir le modal.
 * À l'apparition, la barre glisse depuis le bas (motion design, API Animated du cœur RN).
 */
export function MiniPlayer() {
  const router = useRouter();
  const { track, isPlaying, position, duration } = usePlayback();
  const { togglePlayPause, skipToNext, skipToPrevious } = usePlayer();

  // Entrée : montée + fondu au montage (quand une première piste devient disponible).
  const [enter] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      useNativeDriver: true,
      speed: 16,
      bounciness: 6,
    }).start();
  }, [enter]);

  // Décalage horizontal suivi pendant un glissement latéral (retour visuel : la barre suit le doigt).
  const [swipeX] = useState(() => new Animated.Value(0));

  // Le PanResponder n'est créé qu'une fois ; les actions (stables) sont lues via une ref pour
  // éviter toute closure périmée sans recréer le responder. `PanResponder` du cœur RN (pas de
  // gesture-handler, cf. CLAUDE.md).
  const actionsRef = useRef({
    skipToNext,
    skipToPrevious,
    openPlayer: () => router.push('/now-playing'),
  });
  useEffect(() => {
    actionsRef.current = {
      skipToNext,
      skipToPrevious,
      openPlayer: () => router.push('/now-playing'),
    };
  });

  // Un tap ouvre la lecture ; un glissement pilote la navigation entre pistes / l'ouverture.
  // On ne capte le geste (et n'annule le tap) qu'au-delà d'un petit seuil de mouvement, pour
  // laisser le tap et le bouton play/pause fonctionner normalement.
  /* eslint-disable react-hooks/refs */
  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
        onPanResponderMove: (_e, g) => {
          // Retour visuel uniquement pour l'horizontal (amorti), le vertical reste discret.
          if (Math.abs(g.dx) > Math.abs(g.dy)) {
            swipeX.setValue(g.dx * 0.4);
          }
        },
        onPanResponderRelease: (_e, g) => {
          const horizontal = Math.abs(g.dx) > Math.abs(g.dy);
          if (horizontal && g.dx <= -SWIPE_DISTANCE) {
            tapLight();
            actionsRef.current.skipToNext();
          } else if (horizontal && g.dx >= SWIPE_DISTANCE) {
            tapLight();
            actionsRef.current.skipToPrevious();
          } else if (!horizontal && g.dy <= -OPEN_DISTANCE) {
            actionsRef.current.openPlayer();
          }
          Animated.spring(swipeX, {
            toValue: 0,
            useNativeDriver: true,
            speed: 20,
            bounciness: 8,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(swipeX, {
            toValue: 0,
            useNativeDriver: true,
            speed: 20,
            bounciness: 8,
          }).start();
        },
      }),
    [swipeX]
  );
  /* eslint-enable react-hooks/refs */

  // Rien à afficher tant que la file est vide. (Hooks appelés avant ce retour : règles respectées.)
  if (!track) {
    return null;
  }

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const title = track.title ?? 'Titre inconnu';
  const artist = track.artist ?? 'Artiste inconnu';

  return (
    <Animated.View
      {...swipeResponder.panHandlers}
      style={{
        opacity: enter,
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
          { translateX: swipeX },
        ],
      }}
    >
      <Pressable
        onPress={() => router.push('/now-playing')}
        style={styles.container}
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir la lecture en cours : ${title}, ${artist}. Glissez horizontalement pour changer de piste, vers le haut pour ouvrir la lecture.`}
      >
        {/* Barre de progression fine (Forge : à plat, pleine largeur). */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <View style={styles.row}>
          <Cover
            uri={typeof track.artworkUrl === 'string' ? track.artworkUrl : null}
            seed={`${title}${artist}`}
          />
          <View style={styles.meta}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {artist}
            </Text>
          </View>
          <PressableScale
            onPress={() => {
              tapLight();
              void togglePlayPause();
            }}
            style={styles.playHit}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'}
          >
            <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={30} color={colors.accentIcon} />
          </PressableScale>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Pochette du mini-player : image du tag, ou dégradé de repli déterministe. */
function Cover({ uri, seed }: { uri: string | null; seed: string }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.cover} contentFit="cover" accessible={false} />;
  }
  return (
    <LinearGradient
      colors={coverGradient(seed) as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.cover}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    // Élévation : le mini-player se détache de la tab bar / du contenu derrière.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 12,
  },
  progressTrack: {
    height: 2,
    backgroundColor: colors.border,
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.accent,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: coverFallback,
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
  },
  playHit: {
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
  },
});

export default MiniPlayer;
