import { Switch, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { RepeatMode } from 'react-native-track-player';

import { colors, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { SegmentedControl, type Segment } from '@/components/SegmentedControl';
import { usePlaybackMode } from '@/player/PlayerProvider';
import { tapLight } from '@/lib/haptics';

/** Clés du sélecteur de répétition (SegmentedControl est typé `string`). */
type RepeatKey = 'off' | 'queue' | 'track';

const REPEAT_SEGMENTS: Segment<RepeatKey>[] = [
  { value: 'off', label: 'Désactivée' },
  { value: 'queue', label: 'La file' },
  { value: 'track', label: 'La piste' },
];

function repeatToKey(mode: RepeatMode): RepeatKey {
  if (mode === RepeatMode.Queue) {
    return 'queue';
  }
  if (mode === RepeatMode.Track) {
    return 'track';
  }
  return 'off';
}

function keyToRepeat(key: RepeatKey): RepeatMode {
  if (key === 'queue') {
    return RepeatMode.Queue;
  }
  if (key === 'track') {
    return RepeatMode.Track;
  }
  return RepeatMode.Off;
}

/** Réglages > Lecture : mode de répétition + lecture aléatoire (persistés). */
export default function PlaybackSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { repeatMode, shuffle, setRepeat, toggleShuffle } = usePlaybackMode();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <BackButton onPress={() => router.back()} />

      <Text style={styles.title}>Lecture</Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Répétition</Text>
        <SegmentedControl
          segments={REPEAT_SEGMENTS}
          value={repeatToKey(repeatMode)}
          onChange={(key) => {
            tapLight();
            setRepeat(keyToRepeat(key));
          }}
        />
        <Text style={styles.hint}>
          Rejoue la file en boucle, une seule piste, ou s’arrête à la fin.
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.rowLabel}>Lecture aléatoire</Text>
            <Text style={styles.hint}>Mélange l’ordre des morceaux à venir.</Text>
          </View>
          <Switch
            value={shuffle}
            onValueChange={() => {
              tapLight();
              toggleShuffle();
            }}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.textPrimary}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.display,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  section: {
    paddingTop: spacing.lg,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.accentLabel,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  hint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
  },
  rowLabel: {
    ...typography.heading,
  },
});
