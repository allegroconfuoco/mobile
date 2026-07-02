import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, coverFallback, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';

/**
 * Mini-player persistant (placeholder).
 *
 * Posé au-dessus de la tab bar. Un tap ouvre l'écran Lecture (modal « now-playing »).
 * Les données sont statiques pour l'instant : la vraie lecture arrive avec
 * react-native-track-player (cf. PROJET.md, Phase 1).
 */
export function MiniPlayer() {
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push('/now-playing')}
      style={styles.container}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir la lecture en cours : Ville endormie, Nuit Blanche"
    >
      {/* Barre de progression fine (Forge : à plat, pleine largeur). */}
      <View style={styles.progressTrack}>
        <View style={styles.progressFill} />
      </View>

      <View style={styles.row}>
        <View style={styles.cover} />
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            Ville endormie
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            Nuit Blanche
          </Text>
        </View>
        <Icon name="pause" size={30} color={colors.accentIcon} />
      </View>
    </Pressable>
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
    width: '46%',
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
