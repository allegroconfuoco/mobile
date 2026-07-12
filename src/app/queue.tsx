import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMemo } from 'react';

import { colors, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { ToastHost, showToast } from '@/components/Toast';
import { DraggableTrackList, type DraggableTrackItem } from '@/components/DraggableTrackList';
import { usePlayer, useQueue } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';
import { tapMedium } from '@/lib/haptics';

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
  const { skipToIndex, moveInQueue, removeFromQueue, clearQueue } = usePlayer();

  const confirmClear = () => {
    Alert.alert('Vider la file', 'La piste en cours de lecture est conservée.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Vider',
        style: 'destructive',
        onPress: () => {
          tapMedium();
          void clearQueue();
          showToast('File vidée', 'delete_sweep');
        },
      },
    ]);
  };

  const count = tracks.length;
  const subtitle = count === 0 ? 'File vide' : `${count} ${count > 1 ? 'titres' : 'titre'} en file`;

  // Projette les `MediaItem` du lecteur vers la forme normalisée de la liste réordonnable.
  const items = useMemo<DraggableTrackItem[]>(
    () =>
      tracks.map((t) => ({
        id: t.mediaId ?? '',
        title: t.title ?? 'Titre inconnu',
        artist: t.artist ?? 'Artiste inconnu',
        artworkUri: typeof t.artworkUrl === 'string' ? t.artworkUrl : null,
      })),
    [tracks]
  );

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
        {count > 1 ? (
          <Pressable
            onPress={confirmClear}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Vider la file d'attente"
          >
            <Icon name="delete_sweep" size={24} color={colors.textSecondary} />
          </Pressable>
        ) : (
          /* Espace symétrique au chevron pour centrer le titre. */
          <View style={styles.topSpacer} />
        )}
      </View>

      {count === 0 ? (
        <View style={styles.centered}>
          <Icon name="queue_music" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Aucune piste dans la file.</Text>
        </View>
      ) : (
        <DraggableTrackList
          items={items}
          activeTrackId={activeTrack?.mediaId}
          onPlay={(index) => void skipToIndex(index)}
          onMove={(from, to) => void moveInQueue(from, to)}
          onRemove={(index) => void removeFromQueue(index)}
          removeLabel="Retirer de la file"
          contentPaddingBottom={insets.bottom + spacing.xxl}
        />
      )}

      {/* Modal natif : le host racine ne passe pas au-dessus, on monte le nôtre (cf. Toast.tsx). */}
      <ToastHost variant="modal" />
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
