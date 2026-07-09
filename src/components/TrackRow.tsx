import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import type { LocalTrack } from '@/library/useAudioLibrary';

/**
 * Hauteur fixe d'une ligne de piste : pochette/n° (44) + 2 × paddingVertical (spacing.md).
 * Sert au `getItemLayout` des listes virtualisées — doit rester exacte si le style change.
 */
export const TRACK_ROW_HEIGHT = 44 + 2 * spacing.md;

/** `getItemLayout` prêt à l'emploi pour une FlatList de lignes de piste (hauteur fixe, sans header). */
export function trackRowLayout(
  _data: unknown,
  index: number
): { length: number; offset: number; index: number } {
  return { length: TRACK_ROW_HEIGHT, offset: TRACK_ROW_HEIGHT * index, index };
}

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
 * paresseuse par ligne. Mémoïsée : dans une liste de plusieurs milliers de titres, seules les
 * lignes dont les props changent (piste active, données rafraîchies) doivent re-rendre.
 */
export const TrackRow = memo(function TrackRow({
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
        <TrackCover
          uri={track.artworkUri ?? track.coverArtUrl}
          seed={`${track.title}${track.artist ?? ''}`}
        />
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
});

type TrackIndexRowProps = {
  track: LocalTrack;
  /** Index de lecture (position dans la file que `onPlay` va charger). */
  index: number;
  isActive: boolean;
  onPlay: (index: number) => void;
  onLongPress?: (track: LocalTrack) => void;
  leadingNumber?: number | null;
  subtitle?: string;
};

/**
 * Wrapper mémoïsé pour les listes : construit les closures `onPress`/`onLongPress` **en interne**
 * à partir de handlers stables (`onPlay(index)`, `onLongPress(track)`). Sans lui, chaque re-rendu
 * du parent recrée les closures passées à `TrackRow` et son `memo` ne sert à rien.
 */
export const TrackIndexRow = memo(function TrackIndexRow({
  track,
  index,
  isActive,
  onPlay,
  onLongPress,
  leadingNumber,
  subtitle,
}: TrackIndexRowProps) {
  return (
    <TrackRow
      track={track}
      isActive={isActive}
      onPress={() => onPlay(index)}
      onLongPress={onLongPress ? () => onLongPress(track) : undefined}
      leadingNumber={leadingNumber}
      subtitle={subtitle}
    />
  );
});

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
