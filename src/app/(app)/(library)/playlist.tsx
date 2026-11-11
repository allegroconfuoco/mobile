import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { DetailHero, DetailTopBar, TopBarButton } from '@/components/DetailScreen';
import { DraggableTrackList, type DraggableTrackItem } from '@/components/DraggableTrackList';
import { Icon } from '@/components/Icon';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import { PressableScale } from '@/components/PressableScale';
import { QuickActionsSheet } from '@/components/QuickActionsSheet';
import { showToast } from '@/components/Toast';
import { TrackListItem } from '@/components/TrackListItem';
import { trackRowLayout } from '@/components/TrackRow';
import { useTrackListActions } from '@/components/useTrackListActions';
import { tapMedium } from '@/lib/haptics';
import { useRouter } from '@/lib/useRouter';
import { UNKNOWN_ARTIST } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { useActiveTrack } from '@/player/usePlayback';

import { countLabel } from '@/tabs/shared';

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Détail d'une playlist : lecture, réordonnancement par la poignée, retrait, ajout de titres,
 * renommage, suppression.
 *
 * Chaque entrée est résolue depuis `tracksById` via son id partagé → id media-store (cf.
 * `track_registry`). Une piste sans fichier local — référence synchronisée depuis un autre
 * appareil — reste affichée mais **grisée et non jouable**, pour que la playlist reste la même d'un
 * appareil à l'autre. La file de lecture ne contient que les pistes jouables.
 *
 * L'appui long sur un titre ouvre la sélection multiple ; la liste passe alors en liste simple à
 * cocher (glisser pour réordonner et cocher sont deux gestes qui ne cohabitent pas), avec une
 * action « Retirer » en plus des actions habituelles.
 */
export default function PlaylistScreen() {
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
  const activeId = useActiveTrack()?.mediaId;

  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const playlist = playlists.find((p) => p.id === id);
  const name = playlist?.name ?? 'Playlist';
  const source = useMemo(() => ({ kind: 'playlist' as const, id, name }), [id, name]);
  const context = `playlist:${id}` as const;

  // Entrées dans l'ordre, chacune résolue (ou non) vers un fichier local. `revision` force la
  // relecture après une mutation ou un pull de synchro.
  const entries = useMemo(() => {
    void revision;
    return getEntries(id).map((entry) => ({
      entry,
      localTrack: entry.localTrackId !== null ? (tracksById.get(entry.localTrackId) ?? null) : null,
    }));
  }, [id, getEntries, tracksById, revision]);

  const playableTracks = useMemo<LocalTrack[]>(
    () => entries.map((e) => e.localTrack).filter((t): t is LocalTrack => t !== null),
    [entries]
  );

  const actions = useTrackListActions(playableTracks, {
    extraAction: {
      icon: 'close',
      label: 'Retirer',
      onPress: (selected) => {
        const ids = new Set(selected.map((t) => t.id));
        for (const { entry, localTrack } of entries) {
          if (localTrack && ids.has(localTrack.id)) {
            removeTrackFromPlaylist(id, entry.sharedTrackId);
          }
        }
        showToast(
          selected.length > 1 ? `${selected.length} titres retirés` : 'Titre retiré',
          'playlist_add_check'
        );
      },
    },
  });
  const { selection, onAdd, onPlayNext } = actions;

  const items = useMemo<DraggableTrackItem[]>(
    () =>
      entries.map(({ entry, localTrack }) => ({
        // Clé = id partagé (stable, présent même sans fichier local).
        id: entry.sharedTrackId,
        title: localTrack?.title ?? entry.title ?? 'Titre inconnu',
        artist: localTrack?.artist ?? entry.artist ?? UNKNOWN_ARTIST,
        artworkUri: localTrack?.artworkUri ?? null,
        unavailable: localTrack === null,
      })),
    [entries]
  );

  const count = entries.length;
  const unavailableCount = count - playableTracks.length;
  const cover = playableTracks.map((t) => t.artworkUri).find(Boolean) ?? null;

  // Id partagé de la piste en cours (le lecteur raisonne en id media-store).
  const activeSharedId = useMemo(
    () => entries.find((e) => e.localTrack?.id === activeId)?.entry.sharedTrackId,
    [entries, activeId]
  );

  // Lance la playlist depuis une entrée : les indisponibles sont sautées, la file démarre au bon
  // index parmi les pistes jouables.
  const playFromEntry = (index: number) => {
    const localTrack = entries[index]?.localTrack;
    if (!localTrack) {
      return;
    }
    const startIndex = playableTracks.findIndex((t) => t.id === localTrack.id);
    playQueue(playableTracks, Math.max(0, startIndex), context, source);
  };

  const playFromPlayable = useCallback(
    (index: number) => playQueue(playableTracks, index, context, source),
    [playQueue, playableTracks, context, source]
  );

  const addTitles = () => router.push({ pathname: '/playlist-add', params: { id } });

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

  const selectionMode = selection.active;
  const { isSelected, toggle, start } = selection;
  const renderSelectable = useCallback(
    ({ item, index }: { item: LocalTrack; index: number }) => (
      <TrackListItem
        track={item}
        index={index}
        isActive={item.id === activeId}
        onPlay={playFromPlayable}
        onLongPress={start}
        onAdd={onAdd}
        onPlayNext={onPlayNext}
        selectionMode={selectionMode}
        selected={isSelected(item.id)}
        onToggleSelect={toggle}
      />
    ),
    [activeId, playFromPlayable, start, onAdd, onPlayNext, selectionMode, isSelected, toggle]
  );

  return (
    <View style={styles.screen}>
      <DetailTopBar>
        <TopBarButton icon="add" label="Ajouter des titres" onPress={addTitles} />
        <TopBarButton icon="more_horiz" label="Plus d’actions" onPress={() => setMenuOpen(true)} />
      </DetailTopBar>

      <DetailHero
        kind="Playlist"
        title={name}
        meta={
          countLabel(count, 'titre') +
          (unavailableCount > 0
            ? ` · ${unavailableCount} indisponible${unavailableCount > 1 ? 's' : ''}`
            : '')
        }
        cover={{ uri: cover, icon: 'queue_music', seed: name }}
        tracks={playableTracks}
        context={context}
        source={source}
      />

      {selection.header}

      {count === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Playlist vide.</Text>
          <PressableScale
            onPress={addTitles}
            style={styles.emptyAdd}
            accessibilityRole="button"
            accessibilityLabel="Ajouter des titres"
          >
            <Icon name="add" size={20} color={colors.onAccent} />
            <Text style={styles.emptyAddLabel}>Ajouter des titres</Text>
          </PressableScale>
        </View>
      ) : selectionMode ? (
        <FlatList
          data={playableTracks}
          keyExtractor={(track) => track.id}
          getItemLayout={trackRowLayout}
          renderItem={renderSelectable}
          windowSize={9}
          initialNumToRender={12}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <DraggableTrackList
          items={items}
          activeTrackId={activeSharedId}
          onPlay={playFromEntry}
          onMove={(from, to) => {
            // La liste est déjà réordonnée à l'écran ; l'écriture en base et le re-rendu de
            // l'écran sortent de l'image du lâcher, sinon le relâchement « accroche ».
            const order = arrayMove(entries, from, to).map((e) => e.entry.sharedTrackId);
            setTimeout(() => reorderPlaylist(id, order), 0);
          }}
          onRemove={(index) => removeTrackFromPlaylist(id, entries[index].entry.sharedTrackId)}
          onLongPress={(index) => {
            const localTrack = entries[index]?.localTrack;
            if (localTrack) {
              start(localTrack);
            }
          }}
          removeLabel="Retirer de la playlist"
          contentPaddingBottom={spacing.xxl}
        />
      )}

      {selection.footer}
      {actions.element}

      <PlaylistNameDialog
        visible={renaming}
        title="Renommer la playlist"
        initialValue={name}
        submitLabel="Renommer"
        onSubmit={(newName) => renamePlaylist(id, newName)}
        onClose={() => setRenaming(false)}
      />

      <QuickActionsSheet
        visible={menuOpen}
        title={name}
        onClose={() => setMenuOpen(false)}
        actions={[
          { icon: 'add', label: 'Ajouter des titres', onPress: addTitles },
          { icon: 'edit', label: 'Renommer', onPress: () => setRenaming(true) },
          // Destructive en dernier.
          { icon: 'delete', label: 'Supprimer la playlist', onPress: confirmDelete },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingBottom: spacing.xxl,
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
  emptyAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  emptyAddLabel: {
    ...typography.heading,
    fontSize: 15,
    color: colors.onAccent,
  },
});
