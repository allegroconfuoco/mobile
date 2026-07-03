import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import type { LocalTrack } from '@/library/useAudioLibrary';

/** Formate une durée (ms) en `m:ss`. */
export function formatDuration(ms: number | null): string {
  if (ms == null || ms <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type TrackRowProps = {
  track: LocalTrack;
  isActive: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** Affiche un n° de piste en tête à la place de la pochette (vue album). */
  leadingNumber?: number | null;
  /** Sous-titre custom ; par défaut « artiste · album ». */
  subtitle?: string;
};

/**
 * Ligne de piste réutilisable (bibliothèque, détail artiste, détail album).
 *
 * Les tags (titre / artiste / album / pochette) sont lus directement depuis `LocalTrack` :
 * ils sont désormais persistés au scan (cf. `useAudioLibrary`), plus besoin de lecture
 * paresseuse par ligne.
 */
export function TrackRow({
  track,
  isActive,
  onPress,
  onLongPress,
  leadingNumber,
  subtitle,
}: TrackRowProps) {
  const meta = subtitle ?? defaultSubtitle(track);
  const showNumber = leadingNumber !== undefined;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityState={isActive ? { selected: true } : {}}
      accessibilityLabel={`Lire ${track.title}`}
      accessibilityHint={onLongPress ? 'Appui long pour ajouter à la file' : undefined}
    >
      {showNumber ? (
        <View style={styles.numberBox}>
          {isActive ? (
            <Icon name="graphic_eq" size={18} color={colors.accentIcon} />
          ) : (
            <Text style={styles.number}>{leadingNumber ?? '·'}</Text>
          )}
        </View>
      ) : (
        <TrackCover uri={track.artworkUri} />
      )}
      <View style={styles.text}>
        <Text style={[styles.title, isActive && styles.titleActive]} numberOfLines={1}>
          {track.title}
        </Text>
        {meta.length > 0 && (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
      {isActive && !showNumber ? (
        <Icon name="graphic_eq" size={20} color={colors.accentIcon} />
      ) : (
        <Text style={styles.duration}>{formatDuration(track.durationMs)}</Text>
      )}
    </Pressable>
  );
}

/** Sous-titre par défaut : artiste · album, avec repli. */
function defaultSubtitle(track: LocalTrack): string {
  return [track.artist, track.album].filter(Boolean).join(' · ') || 'Artiste inconnu';
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  numberBox: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    ...typography.body,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  text: {
    flex: 1,
  },
  title: {
    ...typography.heading,
  },
  titleActive: {
    color: colors.accentIcon,
  },
  meta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  duration: {
    ...typography.body,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
});

export default TrackRow;
