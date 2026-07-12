import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/useRouter';

import { colors, radii, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import { tapMedium } from '@/lib/haptics';
import { DraggableTrackList, type DraggableTrackItem } from '@/components/DraggableTrackList';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import { useTrackActionsMenu } from '@/components/useTrackActionsMenu';
import { UNKNOWN_ARTIST } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { useActiveTrack } from '@/player/usePlayback';

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Détail d'une playlist (issue #14 + synchro #17) : lecture, réordonnancement, retrait, renommage,
 * suppression.
 *
 * Chaque entrée est résolue depuis `tracksById` (toutes les pistes scannées, dossiers exclus
 * compris) via son id partagé → id media-store (cf. `track_registry`). Une piste sans fichier local
 * — typiquement une référence synchronisée depuis un autre appareil — reste affichée mais **grisée
 * et non jouable** (« indisponible »), au lieu d'être masquée : la playlist reste cohérente d'un
 * appareil à l'autre. La file de lecture ne contient que les pistes réellement jouables.
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
    getEntries,
    reorderPlaylist,
    removeTrackFromPlaylist,
    renamePlaylist,
    deletePlaylist,
  } = usePlaylistsContext();
  const { playQueue } = usePlayer();
  const activeTrack = useActiveTrack();
  const trackMenu = useTrackActionsMenu();

  const [renaming, setRenaming] = useState(false);

  const playlist = playlists.find((p) => p.id === id);
  const name = playlist?.name ?? 'Playlist';

  // Entrées de la playlist dans l'ordre, chacune résolue (ou non) vers un fichier local.
  // `revision` force la relecture après mutation ou après un pull de synchro.
  const entries = useMemo(() => {
    return getEntries(id).map((entry) => {
      const localTrack =
        entry.localTrackId !== null ? (tracksById.get(entry.localTrackId) ?? null) : null;
      return { entry, localTrack };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, getEntries, tracksById, revision]);

  // Pistes réellement jouables (fichier présent), pour la file de lecture.
  const playableTracks = useMemo<LocalTrack[]>(
    () => entries.map((e) => e.localTrack).filter((t): t is LocalTrack => t !== null),
    [entries]
  );

  const items = useMemo<DraggableTrackItem[]>(
    () =>
      entries.map(({ entry, localTrack }) => ({
        // Clé = id partagé (stable, présent même sans fichier local) → surlignage/DnD cohérents.
        id: entry.sharedTrackId,
        title: localTrack?.title ?? entry.title ?? 'Titre inconnu',
        artist: localTrack?.artist ?? entry.artist ?? UNKNOWN_ARTIST,
        artworkUri: localTrack?.artworkUri ?? localTrack?.coverArtUrl ?? null,
        unavailable: localTrack === null,
      })),
    [entries]
  );

  const count = entries.length;
  const unavailableCount = count - playableTracks.length;

  // Id partagé de la piste en cours de lecture (le lecteur raisonne en id media-store).
  const activeSharedId = useMemo(
    () => entries.find((e) => e.localTrack?.id === activeTrack?.mediaId)?.entry.sharedTrackId,
    [entries, activeTrack?.mediaId]
  );

  // Lance la playlist à partir d'une entrée : ignore les indisponibles, démarre la file sur les
  // pistes jouables au bon index.
  const playFrom = (index: number) => {
    const localTrack = entries[index]?.localTrack;
    if (!localTrack) {
      return;
    }
    const startIndex = playableTracks.findIndex((t) => t.id === localTrack.id);
    void playQueue(playableTracks, startIndex < 0 ? 0 : startIndex, `playlist:${id}`);
  };

  const confirmDelete = () => {
    Alert.alert('Supprimer la playlist', `« ${name} » sera supprimée définitivement.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          tapMedium();
          deletePlaylist(id);
          showToast('Playlist supprimée', 'delete');
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
            onPress={() =>
              router.push({
                pathname: '/write-tags',
                params: { scope: 'playlist', playlistId: id, label: name },
              })
            }
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Écrire les titres de la playlist dans les fichiers"
          >
            <Icon name="save" size={24} color={colors.textPrimary} />
          </Pressable>
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
          {unavailableCount > 0
            ? ` · ${unavailableCount} indisponible${unavailableCount > 1 ? 's' : ''}`
            : ''}
        </Text>
        {playableTracks.length > 0 && (
          <Pressable
            onPress={() => void playQueue(playableTracks, 0, `playlist:${id}`)}
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
          activeTrackId={activeSharedId}
          onPlay={playFrom}
          onMove={(from, to) => {
            // Interface d'abord : la liste est déjà réordonnée de façon optimiste par
            // DraggableTrackList ; l'écriture SQLite + le refresh (re-rendu complet de l'écran)
            // sortent de la frame du lâcher du geste, sinon le relâchement « accroche ».
            const order = arrayMove(entries, from, to).map((e) => e.entry.sharedTrackId);
            setTimeout(() => reorderPlaylist(id, order), 0);
          }}
          onRemove={(index) => removeTrackFromPlaylist(id, entries[index].entry.sharedTrackId)}
          // Appui long → menu d'actions, seulement pour une entrée résolue en fichier local
          // (les pistes indisponibles n'exposent déjà pas le geste, cf. DraggableTrackList).
          onLongPress={(index) => {
            const localTrack = entries[index]?.localTrack;
            if (localTrack) {
              trackMenu.open(localTrack);
            }
          }}
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

      {trackMenu.element}
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
