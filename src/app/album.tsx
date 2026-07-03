import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { TrackCover } from '@/components/TrackCover';
import { TrackRow } from '@/components/TrackRow';
import { makeAlbumKey, tracksForAlbum, UNKNOWN_ALBUM, UNKNOWN_ARTIST } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/**
 * Détail d'un album (issue #13) : ses pistes dans l'ordre (n° de piste puis titre).
 *
 * Reçoit `artist` (album artist) et `title` en params de route, reconstruit la clé d'album et
 * filtre la bibliothèque partagée — pas de duplication de la métadonnée, tout dérive de la même
 * source que l'onglet Albums.
 */
export default function AlbumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ artist?: string; title?: string }>();
  const artist = params.artist ?? UNKNOWN_ARTIST;
  const title = params.title ?? UNKNOWN_ALBUM;

  const { tracks } = useLibrary();
  const { playQueue } = usePlayer();
  const { track: activeTrack } = usePlayback();

  const albumTracks = useMemo(
    () => tracksForAlbum(tracks, makeAlbumKey(artist, title)),
    [tracks, artist, title]
  );
  const cover = albumTracks.find((t) => t.artworkUri)?.artworkUri ?? null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <BackButton onPress={() => router.back()} />

      <FlatList
        data={albumTracks}
        keyExtractor={(track) => track.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <TrackCover uri={cover} size={132} fallbackIcon="album" />
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {artist}
            </Text>
            <Text style={styles.count}>
              {albumTracks.length} {albumTracks.length > 1 ? 'titres' : 'titre'}
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            isActive={item.id === activeTrack?.id}
            leadingNumber={item.trackNo ?? index + 1}
            subtitle={item.artist ?? UNKNOWN_ARTIST}
            onPress={() => void playQueue(albumTracks, index)}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>Album introuvable.</Text>}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  artist: {
    ...typography.body,
    color: colors.textSecondary,
  },
  count: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.xs,
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
