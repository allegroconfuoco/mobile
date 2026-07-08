import { useMemo } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { TrackRow } from '@/components/TrackRow';
import { useTrackActionsMenu } from '@/components/useTrackActionsMenu';
import {
  buildAlbums,
  tracksForAlbum,
  tracksForArtist,
  UNKNOWN_ARTIST,
  type AlbumGroup,
} from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/**
 * Détail d'un artiste (issue #12) : ses morceaux regroupés par album.
 *
 * Reçoit le nom en param de route et filtre la bibliothèque partagée. Chaque en-tête d'album est
 * cliquable et ouvre le détail de l'album (issue #13). La file de lecture est l'ensemble des
 * pistes de l'artiste, ordonnées album par album, pour rester cohérente quel que soit le tap.
 */
export default function ArtistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string }>();
  const name = params.name ?? UNKNOWN_ARTIST;

  const { tracks } = useLibrary();
  const { playQueue } = usePlayer();
  const { track: activeTrack } = usePlayback();
  const trackMenu = useTrackActionsMenu();

  // Sections (un album = une section) + file de lecture à plat, dérivées ensemble.
  const { sections, queue, albumCount } = useMemo(() => {
    const artistTracks = tracksForArtist(tracks, name);
    const albums = buildAlbums(artistTracks);
    const built = albums.map((album) => ({
      album,
      data: tracksForAlbum(artistTracks, album.key),
    }));
    return {
      sections: built,
      queue: built.flatMap((s) => s.data),
      albumCount: albums.length,
    };
  }, [tracks, name]);

  // Index d'une piste dans la file à plat, pour lancer la lecture au bon endroit.
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    queue.forEach((t, i) => map.set(t.id, i));
    return map;
  }, [queue]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <BackButton onPress={() => router.back()} />

      <SectionList
        sections={sections}
        keyExtractor={(track) => track.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.name} numberOfLines={2}>
              {name}
            </Text>
            <Text style={styles.meta}>
              {queue.length} {queue.length > 1 ? 'titres' : 'titre'} · {albumCount}{' '}
              {albumCount > 1 ? 'albums' : 'album'}
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <AlbumHeader
            album={section.album}
            onPress={() =>
              router.push({
                pathname: '/album',
                params: { artist: section.album.artist, title: section.album.title },
              })
            }
          />
        )}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            isActive={item.id === activeTrack?.id}
            leadingNumber={item.trackNo ?? index + 1}
            // L'album est déjà dans l'en-tête de section : sous-titre masqué pour ne pas répéter.
            subtitle=""
            onPress={() => void playQueue(queue, indexById.get(item.id) ?? 0)}
            onLongPress={() => trackMenu.open(item)}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>Artiste introuvable.</Text>}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {trackMenu.element}
    </View>
  );
}

/** En-tête d'album cliquable (ouvre le détail de l'album). */
function AlbumHeader({ album, onPress }: { album: AlbumGroup; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.albumHeader, pressed && styles.albumHeaderPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Album ${album.title}`}
    >
      <Text style={styles.albumTitle} numberOfLines={1}>
        {album.title}
      </Text>
      <Icon name="chevron_right" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  name: {
    ...typography.display,
    fontSize: 26,
  },
  meta: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  albumHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  albumHeaderPressed: {
    backgroundColor: colors.surface,
  },
  albumTitle: {
    ...typography.label,
    color: colors.accentLabel,
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  empty: {
    ...typography.body,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
});
