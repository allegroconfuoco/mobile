import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { formatClock } from '@/history/format';
import * as db from '@/library/db';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { REMOTE_STATE_KEY } from '@/sync/playSync';
import type { PlaybackStatePull } from '@/sync/syncTypes';

/**
 * Carte « Reprendre » (handoff inter-appareils, issue #25) : si un autre appareil a poussé un
 * état de lecture plus frais que la dernière activité locale, propose de reprendre la piste à
 * la seconde près — à condition que le fichier existe ici (résolution via `track_registry`,
 * jamais de transfert d'audio). Rendue en bannière sur l'index bibliothèque.
 */

// Au-delà, la proposition n'a plus de sens (on ne « reprend » pas une écoute d'il y a 15 jours).
const FRESHNESS_MS = 7 * 86_400_000;

type Resume = {
  track: LocalTrack;
  positionMs: number;
  deviceName: string | null;
  /** Jeton de rejet : l'updatedAt distant, mémorisé quand l'utilisateur ferme la carte. */
  stamp: string;
};

/** Relit l'état distant et décide si la carte doit se montrer. */
function computeResume(tracksById: Map<string, LocalTrack>): Resume | null {
  const raw = db.getSyncState(REMOTE_STATE_KEY);
  if (!raw) {
    return null;
  }
  let state: PlaybackStatePull;
  try {
    state = JSON.parse(raw) as PlaybackStatePull;
  } catch {
    return null;
  }
  if (!state.trackId || !state.updatedAt || state.positionMs <= 0) {
    return null;
  }
  const updatedMs = new Date(state.updatedAt).getTime();
  if (Number.isNaN(updatedMs) || Date.now() - updatedMs > FRESHNESS_MS) {
    return null;
  }
  // Plus frais que la dernière activité locale, sinon c'est notre propre écho.
  const lastLocal = Number(db.getSetting('playback.lastLocalAt') ?? '0');
  if (updatedMs <= lastLocal) {
    return null;
  }
  if (db.getSetting('handoff.dismissedAt') === state.updatedAt) {
    return null;
  }
  const localId = db.localIdForShared(state.trackId);
  const track = localId ? tracksById.get(localId) : undefined;
  if (!track) {
    return null; // Fichier absent de cet appareil : rien à proposer (l'audio ne circule pas).
  }
  return {
    track,
    positionMs: state.positionMs,
    deviceName: state.deviceName,
    stamp: state.updatedAt,
  };
}

export function ResumeCard() {
  const { tracksById } = useLibrary();
  const { playQueue, seekTo } = usePlayer();
  const [resume, setResume] = useState<Resume | null>(null);

  // Recalculé au focus : l'état distant arrive par la synchro (connexion, premier plan…).
  useFocusEffect(
    useCallback(() => {
      setResume(computeResume(tracksById));
    }, [tracksById])
  );

  if (!resume) {
    return null;
  }

  const dismiss = () => {
    db.setSetting('handoff.dismissedAt', resume.stamp);
    setResume(null);
  };

  const play = () => {
    const positionMs = resume.positionMs;
    void playQueue([resume.track], 0, 'resume').then(() => {
      seekTo(positionMs / 1000);
    });
    dismiss();
  };

  return (
    <View style={styles.card}>
      <Icon name="cast" size={22} color={colors.accentIcon} />
      <Pressable
        onPress={play}
        style={styles.body}
        accessibilityRole="button"
        accessibilityLabel={`Reprendre ${resume.track.title} à ${formatClock(resume.positionMs)}`}
      >
        <Text style={styles.title} numberOfLines={1}>
          Reprendre « {resume.track.title} »
        </Text>
        <Text style={styles.hint} numberOfLines={1}>
          à {formatClock(resume.positionMs)}
          {resume.deviceName ? ` · depuis ${resume.deviceName}` : ''}
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
