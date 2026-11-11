import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { colors, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { SegmentedControl, type Segment } from '@/components/SegmentedControl';
import { TrackCover } from '@/components/TrackCover';
import { TRACK_ROW_HEIGHT, trackRowLayout } from '@/components/TrackRow';
import { DURATION } from '@/lib/motion';
import { subscribeTabReselected } from '@/lib/tabs';
import { useRouter } from '@/lib/useRouter';
import { useAlbums, useArtists } from '@/library/derived';
import type { AlbumGroup, ArtistGroup } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { useSync } from '@/sync/SyncProvider';

import { countLabel, LibraryGate, TabHeader, themedRefresh } from './shared';

type View_ = 'artists' | 'albums';

const VIEWS: Segment<View_>[] = [
  { value: 'artists', label: 'Artistes' },
  { value: 'albums', label: 'Albums' },
];

/**
 * Onglet **Artistes**, avec un sélecteur Artistes / Albums.
 *
 * La vue Artistes rattache les collaborations (« A & B », « A feat. B ») à chacun des artistes
 * connus en solo : ouvrir un artiste montre donc *tous* ses titres. La vue Albums est une grille
 * de pochettes.
 */
export function ArtistsTab() {
  const router = useRouter();
  const { status, tracks, refreshing, rescan } = useLibrary();
  const { status: syncStatus, syncNow } = useSync();
  const artists = useArtists();
  const albums = useAlbums();
  const [view, setView] = useState<View_>('artists');

  const artistsRef = useRef<FlatList<ArtistGroup>>(null);
  const albumsRef = useRef<FlatList<AlbumGroup>>(null);
  useEffect(
    () =>
      subscribeTabReselected((tab) => {
        if (tab === 'artists') {
          artistsRef.current?.scrollToOffset({ offset: 0, animated: true });
          albumsRef.current?.scrollToOffset({ offset: 0, animated: true });
        }
      }),
    []
  );

  const refreshAll = useCallback(() => {
    rescan();
    void syncNow();
  }, [rescan, syncNow]);
  const pulling = refreshing || syncStatus === 'syncing';

  const openArtist = useCallback(
    (name: string) => router.push({ pathname: '/artist', params: { name } }),
    [router]
  );
  const openAlbum = useCallback(
    (album: AlbumGroup) =>
      router.push({ pathname: '/album', params: { artist: album.artist, title: album.title } }),
    [router]
  );

  const renderArtist = useCallback(
    ({ item }: { item: ArtistGroup }) => <ArtistRow artist={item} onOpen={openArtist} />,
    [openArtist]
  );
  const renderAlbum = useCallback(
    ({ item }: { item: AlbumGroup }) => <AlbumTile album={item} onOpen={openAlbum} />,
    [openAlbum]
  );

  const ready = status === 'ready' && tracks.length > 0;
  const subtitle =
    view === 'artists' ? countLabel(artists.length, 'artiste') : countLabel(albums.length, 'album');

  return (
    <View style={styles.screen}>
      <TabHeader title={view === 'artists' ? 'Artistes' : 'Albums'} subtitle={subtitle} />
      {ready ? (
        <>
          <SegmentedControl segments={VIEWS} value={view} onChange={setView} />
          {view === 'artists' ? (
            <Animated.View
              key="artists"
              entering={FadeIn.duration(DURATION.base)}
              style={styles.screen}
            >
              <FlatList
                ref={artistsRef}
                data={artists}
                keyExtractor={artistKey}
                getItemLayout={trackRowLayout}
                renderItem={renderArtist}
                windowSize={9}
                initialNumToRender={10}
                maxToRenderPerBatch={12}
                removeClippedSubviews
                refreshControl={themedRefresh(pulling, refreshAll)}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              />
            </Animated.View>
          ) : (
            <Animated.View
              key="albums"
              entering={FadeIn.duration(DURATION.base)}
              style={styles.screen}
            >
              <FlatList
                ref={albumsRef}
                data={albums}
                keyExtractor={albumKey}
                numColumns={2}
                columnWrapperStyle={styles.albumRow}
                renderItem={renderAlbum}
                windowSize={7}
                initialNumToRender={6}
                maxToRenderPerBatch={8}
                refreshControl={themedRefresh(pulling, refreshAll)}
                contentContainerStyle={styles.albumsContent}
                showsVerticalScrollIndicator={false}
              />
            </Animated.View>
          )}
        </>
      ) : (
        <LibraryGate />
      )}
    </View>
  );
}

const artistKey = (artist: ArtistGroup) => artist.name;
const albumKey = (album: AlbumGroup) => album.key;

/** Ligne d'artiste mémoïsée : même hauteur qu'une ligne de piste (contrat `getItemLayout`). */
const ArtistRow = memo(function ArtistRow({
  artist,
  onOpen,
}: {
  artist: ArtistGroup;
  onOpen: (name: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onOpen(artist.name)}
      android_ripple={{ color: colors.borderStrong }}
      style={({ pressed }) => [styles.artistRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Artiste ${artist.name}`}
    >
      <TrackCover uri={artist.artworkUri} fallbackIcon="person" seed={artist.name} />
      <View style={styles.artistText}>
        <Text style={styles.artistName} numberOfLines={1}>
          {artist.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {countLabel(artist.trackCount, 'titre')} · {countLabel(artist.albumCount, 'album')}
        </Text>
      </View>
      <Icon name="chevron_right" size={22} color={colors.textMuted} />
    </Pressable>
  );
});

/** Tuile d'album mémoïsée (hauteur variable — carré selon la largeur — donc pas de getItemLayout). */
const AlbumTile = memo(function AlbumTile({
  album,
  onOpen,
}: {
  album: AlbumGroup;
  onOpen: (album: AlbumGroup) => void;
}) {
  return (
    <Pressable
      onPress={() => onOpen(album)}
      style={({ pressed }) => [styles.albumTile, pressed && styles.albumPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Album ${album.title}, ${album.artist}`}
    >
      <TrackCover
        uri={album.artworkUri}
        fill
        fallbackIcon="album"
        seed={`${album.title}${album.artist}`}
      />
      <Text style={styles.albumTitle} numberOfLines={1}>
        {album.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {album.artist} · {countLabel(album.trackCount, 'titre')}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: TRACK_ROW_HEIGHT,
    paddingLeft: spacing.xxl,
    paddingRight: spacing.lg,
  },
  artistText: {
    flex: 1,
    minWidth: 0,
  },
  artistName: {
    ...typography.heading,
  },
  meta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  albumsContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  albumRow: {
    gap: spacing.lg,
  },
  albumTile: {
    flex: 1,
    maxWidth: '50%',
  },
  albumPressed: {
    opacity: 0.7,
  },
  albumTitle: {
    ...typography.heading,
    fontSize: 14,
    marginTop: spacing.sm,
  },
});
