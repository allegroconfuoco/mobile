import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { DraggableQueueList } from '@/components/DraggableQueueList';
import { usePlayer, useQueue } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/**
 * Écran File d'attente, présenté en modal.
 *
 * Visualise la file courante (snapshot réactif `useQueue`), avec la piste en cours mise en avant.
 * Réordonnancement par glisser-déposer (poignée), tap pour sauter à une piste, croix pour retirer.
 * Les mutations passent par le lecteur via `usePlayer`.
 */
export default function QueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tracks } = useQueue();
  const { track: activeTrack } = usePlayback();
  const { skipToIndex, moveInQueue, removeFromQueue } = usePlayer();

  const count = tracks.length;
  const subtitle = count === 0 ? 'File vide' : `${count} ${count > 1 ? 'titres' : 'titre'} en file`;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      {/* Barre supérieure : fermer + titre */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Fermer la file d'attente"
        >
          <Icon name="expand_more" size={28} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.topText}>
          <Text style={styles.title}>File d&apos;attente</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {/* Espace symétrique au chevron pour centrer le titre. */}
        <View style={styles.topSpacer} />
      </View>

      {count === 0 ? (
        <View style={styles.centered}>
          <Icon name="queue_music" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Aucune piste dans la file.</Text>
        </View>
      ) : (
        <DraggableQueueList
          tracks={tracks}
          activeTrackId={activeTrack?.id}
          onPlay={(index) => void skipToIndex(index)}
          onMove={(from, to) => void moveInQueue(from, to)}
          onRemove={(index) => void removeFromQueue(index)}
          contentPaddingBottom={insets.bottom + spacing.xxl}
        />
      )}
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
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  topText: {
    flex: 1,
    alignItems: 'center',
  },
  topSpacer: {
    width: 28,
  },
  title: {
    ...typography.title,
    fontSize: 18,
  },
  subtitle: {
    ...typography.label,
    fontSize: 10,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
});
