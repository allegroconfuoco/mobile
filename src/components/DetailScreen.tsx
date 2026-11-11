import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { TrackCover } from '@/components/TrackCover';
import { tapLight } from '@/lib/haptics';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { useRouter } from '@/lib/useRouter';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlaybackMode, usePlayer } from '@/player/PlayerProvider';
import type { PlayContext } from '@/player/playRecorder';
import type { QueueSource } from '@/player/queueSource';

/**
 * Charpente commune des écrans de détail (artiste, album, playlist, favoris, récents) : une barre
 * du haut (retour + actions), puis un « héros » — pochette, titre, compteur, boutons de lecture.
 *
 * Les éléments du héros entrent en cascade (pochette, texte, boutons), chacun montant de quelques
 * pixels : l'écran se « pose » pendant qu'il arrive par la droite, au lieu d'apparaître d'un bloc.
 */

/** Entrée en cascade : `step` = rang de l'élément dans la cascade. */
function enter(step: number) {
  return FadeInDown.duration(DURATION.slow)
    .delay(60 + step * 50)
    .easing(EASE_OUT);
}

/** Barre du haut : retour à gauche, actions de l'écran à droite. */
export function DetailTopBar({ children }: { children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + spacing.xs }]}>
      <TopBarButton icon="arrow_back" label="Retour" onPress={() => router.back()} />
      <View style={styles.topActions}>{children}</View>
    </View>
  );
}

/** Bouton icône de la barre du haut, cible tactile de 44 px. */
export function TopBarButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={4}
      style={styles.topButton}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={26} color={colors.textPrimary} />
    </PressableScale>
  );
}

export type DetailHeroProps = {
  /** Étiquette au-dessus du titre (« Album », « Artiste », « Playlist »). */
  kind: string;
  title: string;
  /** Ligne sous le titre (artiste d'un album, par exemple). */
  subtitle?: string;
  /** Compteur (« 12 titres »). */
  meta: string;
  /** Pochette : image si `uri`, sinon pastille avec `icon`. */
  cover: { uri: string | null; icon: IconName; seed: string };
  /** Pistes jouables de l'écran, dans l'ordre d'affichage : alimentent « Lire » et « Aléatoire ». */
  tracks: LocalTrack[];
  context: PlayContext;
  source: QueueSource | null;
  children?: ReactNode;
};

/** Héros d'un écran de détail, avec ses deux boutons de lecture. */
export function DetailHero({
  kind,
  title,
  subtitle,
  meta,
  cover,
  tracks,
  context,
  source,
  children,
}: DetailHeroProps) {
  const { playQueue } = usePlayer();
  const { shuffle, toggleShuffle } = usePlaybackMode();

  const play = () => {
    tapLight();
    playQueue(tracks, 0, context, source);
  };
  const playShuffled = () => {
    tapLight();
    // Le mode aléatoire est un réglage persistant : on l'active pour que l'écran Lecture et la
    // file reflètent ce qui se joue vraiment.
    if (!shuffle) {
      toggleShuffle();
    }
    playQueue(tracks, Math.floor(Math.random() * tracks.length), context, source);
  };

  return (
    <View style={styles.hero}>
      <Animated.View entering={enter(0)} style={styles.heroTop}>
        <TrackCover uri={cover.uri} size={112} fallbackIcon={cover.icon} seed={cover.seed} />
        <View style={styles.heroText}>
          <Text style={styles.kind}>{kind}</Text>
          <Text style={styles.title} numberOfLines={3}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          <Text style={styles.meta}>{meta}</Text>
        </View>
      </Animated.View>

      {tracks.length > 0 && (
        <Animated.View entering={enter(1)} style={styles.buttons}>
          <PressableScale
            onPress={play}
            style={[styles.button, styles.buttonPrimary]}
            accessibilityRole="button"
            accessibilityLabel={`Lire ${title}`}
          >
            <Icon name="play_arrow" size={22} color={colors.onAccent} />
            <Text style={[styles.buttonLabel, styles.buttonLabelPrimary]}>Lire</Text>
          </PressableScale>
          {tracks.length > 1 && (
            <PressableScale
              onPress={playShuffled}
              style={[styles.button, styles.buttonSecondary]}
              accessibilityRole="button"
              accessibilityLabel={`Lire ${title} en aléatoire`}
            >
              <Icon name="shuffle" size={20} color={colors.textPrimary} />
              <Text style={styles.buttonLabel}>Aléatoire</Text>
            </PressableScale>
          )}
        </Animated.View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.lg,
  },
  heroText: {
    flex: 1,
    minWidth: 0,
  },
  kind: {
    ...typography.label,
    color: colors.accentLabel,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.body,
    fontSize: 14,
    marginTop: 2,
  },
  meta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
    minWidth: 120,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  buttonLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 14,
    color: colors.textPrimary,
  },
  buttonLabelPrimary: {
    color: colors.onAccent,
  },
});
