import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import { formatClock } from '@/history/format';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import {
  dismissResumePoint,
  isResumeDismissed,
  loadResumePoint,
  type ResumePoint,
} from '@/player/resumeState';

/**
 * Carte « Reprendre » : relance la dernière écoute **avec sa file d'attente**, à la seconde près.
 *
 * Purement local (clé `app_settings`, cf. `resumeState`) : le handoff inter-appareils de l'issue
 * #25 a été retiré. On ne reprend donc plus « ce que l'autre téléphone écoutait » mais ce que *ce*
 * téléphone écoutait avant d'être fermé — le seul cas qui servait vraiment.
 *
 * Le point de reprise ne stocke que des ids : la résolution se fait ici contre la bibliothèque
 * courante, et les fichiers disparus depuis sont simplement omis (l'index se recale sur la piste
 * active, ou sur la suivante encore présente).
 */

// Au-delà, la proposition n'a plus de sens (on ne « reprend » pas une écoute d'il y a 15 jours).
const FRESHNESS_MS = 7 * 86_400_000;

type Resume = {
  /** File résolue contre la bibliothèque locale, dans l'ordre. */
  tracks: LocalTrack[];
  /** Index de reprise dans `tracks` (recalé après omission des fichiers disparus). */
  index: number;
  positionMs: number;
  point: ResumePoint;
};

/**
 * Résout le point de reprise contre la bibliothèque, ou renvoie `null` s'il n'y a rien à proposer.
 * Exporté pour l'accueil, qui affiche la même reprise sous forme de tuile.
 */
export function computeResume(tracksById: Map<string, LocalTrack>): Resume | null {
  const point = loadResumePoint();
  if (!point) {
    return null;
  }
  if (Date.now() - point.updatedAt > FRESHNESS_MS || isResumeDismissed(point)) {
    return null;
  }

  // Résolution + recalage de l'index : on garde l'ordre, on saute les fichiers disparus, et
  // l'index vise la piste active si elle est encore là, sinon la première suivante disponible.
  const tracks: LocalTrack[] = [];
  let index = -1;
  for (let i = 0; i < point.trackIds.length; i++) {
    const track = tracksById.get(point.trackIds[i]);
    if (!track) {
      continue;
    }
    if (index === -1 && i >= point.index) {
      index = tracks.length;
    }
    tracks.push(track);
  }
  if (tracks.length === 0) {
    return null;
  }
  // La piste active exacte a disparu et rien ne suivait : on reprend au début de ce qui reste.
  const resolvedIndex = index === -1 ? 0 : index;
  // Reprendre à la position n'a de sens que sur la piste réellement interrompue.
  const exact = tracksById.get(point.trackIds[point.index]) !== undefined;
  return {
    tracks,
    index: resolvedIndex,
    positionMs: exact ? point.positionMs : 0,
    point,
  };
}

export function ResumeCard() {
  const { tracksById } = useLibrary();
  const { playQueue, seekTo } = usePlayer();
  const [resume, setResume] = useState<Resume | null>(null);

  // Recalculé au focus : le point de reprise est écrit par les événements du lecteur, y compris
  // pendant que cet écran n'est pas monté.
  useFocusEffect(
    useCallback(() => {
      setResume(computeResume(tracksById));
    }, [tracksById])
  );

  if (!resume) {
    return null;
  }

  const track = resume.tracks[resume.index];
  const remaining = resume.tracks.length - resume.index - 1;

  const dismiss = () => {
    dismissResumePoint(resume.point);
    setResume(null);
  };

  const play = () => {
    const positionMs = resume.positionMs;
    void playQueue(resume.tracks, resume.index, 'resume').then(() => {
      if (positionMs > 0) {
        seekTo(positionMs / 1000);
      }
    });
    setResume(null);
  };

  return (
    <View style={styles.card}>
      <TrackCover
        uri={track.artworkUri ?? track.coverArtUrl}
        size={40}
        seed={`${track.title}${track.artist ?? ''}`}
      />
      <Pressable
        onPress={play}
        style={styles.body}
        accessibilityRole="button"
        accessibilityLabel={`Reprendre ${track.title} à ${formatClock(resume.positionMs)}`}
      >
        <Text style={styles.title} numberOfLines={1}>
          Reprendre « {track.title} »
        </Text>
        <Text style={styles.hint} numberOfLines={1}>
          à {formatClock(resume.positionMs)}
          {remaining > 0 ? ` · ${remaining} titre${remaining > 1 ? 's' : ''} à suivre` : ''}
        </Text>
      </Pressable>
      <Pressable
        onPress={play}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Reprendre la lecture"
      >
        <Icon name="play_arrow" size={26} color={colors.accent} />
      </Pressable>
      <Pressable
        onPress={dismiss}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Ignorer la reprise"
      >
        <Icon name="close" size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.heading,
    fontSize: 13,
  },
  hint: {
    ...typography.body,
    fontSize: 12,
    marginTop: 1,
  },
});

export default ResumeCard;
