import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, coverFallback, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';

/** Écran Lecture (placeholder), présenté en modal. Contrôles non fonctionnels. */
export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom }]}>
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
        <View style={styles.cover} />
      </View>

      {/* Titre / artiste */}
      <View style={styles.metaBlock}>
        <Text style={styles.eyebrow}>En lecture · Soirée braise</Text>
        <View style={styles.metaRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.trackTitle} numberOfLines={1}>
              Ville endormie
            </Text>
            <Text style={styles.artist}>Nuit Blanche</Text>
          </View>
          <Icon name="favorite_border" size={26} color={colors.accentIcon} />
        </View>
      </View>

      {/* Progression */}
      <View style={styles.progressBlock}>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
          <View style={styles.progressKnob} />
        </View>
        <View style={styles.times}>
          <Text style={styles.time}>1:47</Text>
          <Text style={styles.time}>-2:11</Text>
        </View>
      </View>

      {/* Contrôles */}
      <View style={styles.controls}>
        <Icon name="shuffle" size={23} color={colors.textSecondary} />
        <Icon name="skip_previous" size={34} color={colors.textPrimary} />
        <View style={styles.playButton}>
          <Icon name="pause" size={36} color={colors.onAccent} />
        </View>
        <Icon name="skip_next" size={34} color={colors.textPrimary} />
        <Icon name="repeat" size={23} color={colors.textSecondary} />
      </View>

      {/* Actions secondaires */}
      <View style={styles.secondary}>
        <Icon name="lyrics" size={22} color={colors.textSecondary} />
        <Icon name="queue_music" size={22} color={colors.textSecondary} />
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
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    width: '46%',
    backgroundColor: colors.accent,
  },
  progressKnob: {
    position: 'absolute',
    left: '46%',
    width: 11,
    height: 11,
    marginLeft: -5.5,
    backgroundColor: colors.accent,
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
