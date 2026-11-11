import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, ZoomIn } from 'react-native-reanimated';

import { colors, radii, spacing, typography } from '@/theme';
import { EqualizerBars } from '@/components/EqualizerBars';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import { SPRING_BOUNCY, useSpringFlag } from '@/lib/motion';
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
  /**
   * Mode sélection multiple : le slot de droite cède la place à une case à cocher et le tap
   * coche/décoche (le handler `onPress` fourni par l'appelant porte alors la bascule). Props
   * primitives pour préserver le `memo` ; la hauteur (`TRACK_ROW_HEIGHT`) ne change pas.
   */
  selectionMode?: boolean;
  /** Piste cochée (mode sélection). */
  selected?: boolean;
  /**
   * Bouton « + » du slot de droite : ouvre directement le sélecteur de playlists (Favoris en
   * tête). Non fourni = pas de bouton (listes réordonnables).
   */
  onAdd?: () => void;
};

/**
 * Ligne de piste réutilisable (Morceaux, artiste, album, favoris, recherche).
 *
 * Les tags (titre / artiste / album / pochette) sont lus directement depuis `LocalTrack`,
 * persistés au scan. Mémoïsée : dans une liste de plusieurs milliers de titres, seules les lignes
 * dont les props changent (piste active, coche) doivent re-rendre.
 */
export const TrackRow = memo(function TrackRow({
  track,
  isActive,
  onPress,
  onLongPress,
  leadingNumber,
  subtitle,
  selectionMode = false,
  selected = false,
  onAdd,
}: TrackRowProps) {
  // La durée vit dans le sous-titre : le slot de droite est actionnable, et « 3:42 » se lit très
  // bien en fin de ligne méta. Un `subtitle=""` explicite (vue artiste, où l'album est déjà dans
  // l'en-tête de section) ne doit pas laisser de séparateur orphelin.
  const meta = [subtitle ?? defaultSubtitle(track), formatDuration(track.durationMs)]
    .filter((part) => part.length > 0)
    .join(' · ');
  const showNumber = leadingNumber !== undefined;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={selectionMode ? undefined : onLongPress}
      delayLongPress={280}
      // Ripple natif : feedback dès le touch-down (zéro JS), en plus du fond `pressed`.
      android_ripple={{ color: colors.borderStrong }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole={selectionMode ? 'checkbox' : 'button'}
      accessibilityState={
        selectionMode ? { checked: selected } : isActive ? { selected: true } : {}
      }
      accessibilityLabel={selectionMode ? track.title : `Lire ${track.title}`}
      accessibilityHint={
        onLongPress && !selectionMode ? 'Appui long pour sélectionner plusieurs titres' : undefined
      }
    >
      {showNumber ? (
        <View style={styles.numberBox}>
          {isActive ? <EqualizerBars /> : <Text style={styles.number}>{leadingNumber ?? '·'}</Text>}
        </View>
      ) : (
        <View>
          <TrackCover uri={track.artworkUri} seed={`${track.title}${track.artist ?? ''}`} />
          {isActive && (
            <View style={styles.coverOverlay}>
              <EqualizerBars color={colors.textPrimary} />
            </View>
          )}
        </View>
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
      {selectionMode ? (
        <SelectionCheck selected={selected} />
      ) : onAdd ? (
        <Pressable
          onPress={onAdd}
          hitSlop={6}
          android_ripple={{ color: colors.borderStrong, borderless: true, radius: 22 }}
          style={styles.addButton}
          accessibilityRole="button"
          accessibilityLabel={`Ajouter ${track.title} à une playlist`}
        >
          <Icon name="add" size={24} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

/**
 * Case à cocher du mode sélection : entre avec un léger rebond quand le mode s'ouvre, et la coche
 * « pose » quand on sélectionne la ligne.
 */
export function SelectionCheck({ selected }: { selected: boolean }) {
  const on = useSpringFlag(selected, SPRING_BOUNCY);
  const fill = useAnimatedStyle(() => ({
    opacity: Math.min(1, on.get() * 1.5),
    transform: [{ scale: 0.4 + 0.6 * on.get() }],
  }));
  return (
    <Animated.View entering={ZoomIn.springify().damping(18).stiffness(320)} style={styles.checkbox}>
      <Animated.View style={[styles.checkboxFill, fill]}>
        <Icon name="check" size={16} color={colors.onAccent} />
      </Animated.View>
    </Animated.View>
  );
}

type TrackIndexRowProps = {
  track: LocalTrack;
  /** Index de lecture (position dans la file que `onPlay` va charger). */
  index: number;
  isActive: boolean;
  onPlay: (index: number) => void;
  onLongPress?: (track: LocalTrack) => void;
  leadingNumber?: number | null;
  subtitle?: string;
  /** Mode sélection multiple : le tap bascule la coche (`onToggleSelect`) au lieu de lire. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (track: LocalTrack) => void;
  /** Bouton « + » du slot de droite (cf. `TrackRowProps.onAdd`). */
  onAdd?: (track: LocalTrack) => void;
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
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onAdd,
}: TrackIndexRowProps) {
  return (
    <TrackRow
      track={track}
      isActive={isActive}
      onPress={selectionMode && onToggleSelect ? () => onToggleSelect(track) : () => onPlay(index)}
      onLongPress={onLongPress ? () => onLongPress(track) : undefined}
      leadingNumber={leadingNumber}
      subtitle={subtitle}
      selectionMode={selectionMode}
      selected={selected}
      onAdd={onAdd ? () => onAdd(track) : undefined}
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
  // Voile sombre sur la pochette de la piste en cours, pour que les barres restent lisibles.
  coverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: 'rgba(20,17,16,0.62)',
  },
  // 44×44 : même gabarit tactile que la pochette, donc `TRACK_ROW_HEIGHT` est inchangée.
  addButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    marginHorizontal: 10,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  checkboxFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
});

export default TrackRow;
