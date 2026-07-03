import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { colors, coverFallback, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/**
 * Mini-player persistant, posé au-dessus de la tab bar.
 *
 * Se cache tant qu'aucune piste n'est chargée. Un tap sur la barre ouvre l'écran Lecture
 * (modal « now-playing ») ; le bouton play/pause, lui, pilote la lecture sans ouvrir le modal.
 */
export function MiniPlayer() {
  const router = useRouter();
  const { track, isPlaying, position, duration } = usePlayback();
  const { togglePlayPause } = usePlayer();

  // Rien à afficher tant que la file est vide.
  if (!track) {
    return null;
  }

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const title = track.title ?? 'Titre inconnu';
  const artist = track.artist ?? 'Artiste inconnu';

  return (
    <Pressable
      onPress={() => router.push('/now-playing')}
      style={styles.container}
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir la lecture en cours : ${title}, ${artist}`}
    >
      {/* Barre de progression fine (Forge : à plat, pleine largeur). */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <View style={styles.row}>
        <Cover uri={typeof track.artwork === 'string' ? track.artwork : null} />
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {artist}
          </Text>
        </View>
        <Pressable
          onPress={() => void togglePlayPause()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Mettre en pause' : 'Lire'}
        >
          <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={30} color={colors.accentIcon} />
        </Pressable>
      </View>
    </Pressable>
  );
}

/** Pochette du mini-player : image du tag, ou pastille pleine de repli. */
function Cover({ uri }: { uri: string | null }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.cover} contentFit="cover" accessible={false} />;
  }
  return <View style={styles.cover} />;
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
});

export default MiniPlayer;
