import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { colors, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import { TrackListScreen, type TrackSection } from '@/components/TrackListScreen';
import { useRouter } from '@/lib/useRouter';
import { tracksForMergedArtist } from '@/library/artists';
import { buildAlbums, tracksForAlbum, UNKNOWN_ARTIST, type AlbumGroup } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';

import { countLabel } from '@/tabs/shared';

/**
 * Détail d'un artiste : **tous** ses titres — y compris ses collaborations — regroupés par album.
 *
 * Chaque en-tête d'album ouvre l'album. La file de lecture est l'ensemble des titres de
 * l'artiste, album par album, pour rester cohérente quel que soit le titre touché.
 */
export default function ArtistScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string }>();
  const name = params.name ?? UNKNOWN_ARTIST;
  const { tracks } = useLibrary();

  const { sections, trackCount, albumCount, cover } = useMemo(() => {
    const artistTracks = tracksForMergedArtist(tracks, name);
    const albums = buildAlbums(artistTracks);
    return {
      sections: albums.map<TrackSection>((album) => ({
        key: album.key,
        header: (
          <AlbumHeader
            album={album}
            onPress={() =>
              router.push({
                pathname: '/album',
                params: { artist: album.artist, title: album.title },
              })
            }
          />
        ),
        data: tracksForAlbum(artistTracks, album.key),
      })),
      trackCount: artistTracks.length,
      albumCount: albums.length,
      cover: artistTracks.map((t) => t.artworkUri).find(Boolean) ?? null,
    };
  }, [tracks, name, router]);

  // L'album est dans l'en-tête de section : la ligne ne porte que son numéro, et l'interprète
  // quand c'est une collaboration (« A & B » sur la page de A).
  const rowProps = (track: LocalTrack, index: number) => ({
    leadingNumber: track.trackNo ?? index + 1,
    subtitle: (track.artist ?? '').trim() === name ? '' : (track.artist ?? ''),
  });

  return (
    <TrackListScreen
      kind="Artiste"
      title={name}
      meta={`${countLabel(trackCount, 'titre')} · ${countLabel(albumCount, 'album')}`}
      cover={{ uri: cover, icon: 'person', seed: name }}
      context="artist"
      source={{ kind: 'artist', name }}
      sections={sections}
      rowProps={rowProps}
      emptyText="Artiste introuvable."
    />
  );
}

/** En-tête de section : pochette et titre de l'album, ouvre l'album. */
function AlbumHeader({ album, onPress }: { album: AlbumGroup; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.borderStrong }}
      style={styles.albumHeader}
      accessibilityRole="button"
      accessibilityLabel={`Album ${album.title}`}
    >
      <TrackCover uri={album.artworkUri} size={36} fallbackIcon="album" seed={album.title} />
      <View style={styles.albumText}>
        <Text style={styles.albumTitle} numberOfLines={1}>
          {album.title}
        </Text>
        <Text style={styles.albumMeta}>{countLabel(album.trackCount, 'titre')}</Text>
      </View>
      <Icon name="chevron_right" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  albumHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  albumText: {
    flex: 1,
    minWidth: 0,
  },
  albumTitle: {
    ...typography.heading,
    fontSize: 14,
    color: colors.accentLabel,
  },
  albumMeta: {
    ...typography.body,
    fontSize: 11.5,
    color: colors.textMuted,
  },
});
