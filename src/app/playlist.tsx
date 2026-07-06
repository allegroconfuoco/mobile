import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { DraggableTrackList, type DraggableTrackItem } from '@/components/DraggableTrackList';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import { UNKNOWN_ARTIST } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Détail d'une playlist (issue #14) : lecture, réordonnancement, retrait, renommage, suppression.
 *
 * Les pistes sont résolues depuis `tracksById` (toutes les pistes scannées, dossiers exclus
 * compris) dans l'ordre stocké. Une piste dont le fichier a disparu est simplement omise de
 * l'affichage et de la lecture ; sa référence reste en base sans gêner l'ordre des autres.
 */
export default function PlaylistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';

  const { tracksById } = useLibrary();
  const {
    playlists,
    revision,
    getTrackIds,
    reorderPlaylist,
    removeTrackFromPlaylist,
    renamePlaylist,
    deletePlaylist,
  } = usePlaylistsContext();
  const { playQueue } = usePlayer();
  const { track: activeTrack } = usePlayback();

  const [renaming, setRenaming] = useState(false);

  const playlist = playlists.find((p) => p.id === id);
  const name = playlist?.name ?? 'Playlist';

  // Pistes résolues, dans l'ordre de la playlist. `revision` force la relecture après mutation.
  const localTracks = useMemo<LocalTrack[]>(() => {
    const ids = getTrackIds(id);
    const resolved: LocalTrack[] = [];
    for (const trackId of ids) {
      const track = tracksById.get(trackId);
      if (track) {
        resolved.push(track);
      }
    }
    return resolved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, getTrackIds, tracksById, revision]);

  const items = useMemo<DraggableTrackItem[]>(
    () =>
      localTracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist ?? UNKNOWN_ARTIST,
        artworkUri: t.artworkUri,
      })),
    [localTracks]
  );

  const count = localTracks.length;

  const confirmDelete = () => {
    Alert.alert('Supprimer la playlist', `« ${name} » sera supprimée définitivement.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          deletePlaylist(id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} />
        <View style={styles.topActions}>
          <Pressable
            onPress={() => setRenaming(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Renommer la playlist"
          >
            <Icon name="edit" size={24} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            onPress={confirmDelete}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Supprimer la playlist"
          >
            <Icon name="delete" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.count}>
          {count} {count > 1 ? 'titres' : 'titre'}
        </Text>
        {count > 0 && (
          <Pressable
            onPress={() => void playQueue(localTracks, 0)}
            style={({ pressed }) => [styles.playButton, pressed && styles.playButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Lire la playlist"
          >
            <Icon name="play_arrow" size={22} color={colors.onAccent} />
            <Text style={styles.playLabel}>Lire</Text>
          </Pressable>
        )}
      </View>

      {count === 0 ? (
        <View style={styles.centered}>
          <Icon name="queue_music" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            Playlist vide. Ajoutez des morceaux depuis la bibliothèque (appui long sur une piste).
          </Text>
        </View>
      ) : (
        <DraggableTrackList
          items={items}
          activeTrackId={activeTrack?.id}
          onPlay={(index) => void playQueue(localTracks, index)}
          onMove={(from, to) =>
            reorderPlaylist(
              id,
              arrayMove(localTracks, from, to).map((t) => t.id)
            )
          }
          onRemove={(index) => removeTrackFromPlaylist(id, localTracks[index].id)}
          removeLabel="Retirer de la playlist"
          contentPaddingBottom={insets.bottom + spacing.xxl}
        />
      )}

      <PlaylistNameDialog
        visible={renaming}
        title="Renommer la playlist"
        initialValue={name}
        submitLabel="Renommer"
        onSubmit={(newName) => renamePlaylist(id, newName)}
        onClose={() => setRenaming(false)}
      />
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
    paddingRight: spacing.xxl,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  header: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    ...typography.display,
    fontSize: 26,
  },
  count: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  playButtonPressed: {
    opacity: 0.85,
  },
  playLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 14,
    color: colors.onAccent,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: 72,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
});
