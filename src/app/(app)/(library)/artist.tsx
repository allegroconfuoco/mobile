import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/useRouter';

import { colors, radii, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { SwipeableRow } from '@/components/SwipeableRow';
import { TrackIndexRow } from '@/components/TrackRow';
import { QuickActionsSheet } from '@/components/QuickActionsSheet';
import { useTrackActionsMenu } from '@/components/useTrackActionsMenu';
import { useTrackQuickActions } from '@/components/useTrackQuickActions';
import { useTrackSelection } from '@/components/useTrackSelection';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { buildAlbums, tracksForAlbum, UNKNOWN_ARTIST, type AlbumGroup } from '@/library/grouping';
import { tracksForMergedArtist } from '@/library/artists';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { useActiveTrack } from '@/player/usePlayback';

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
  const activeTrack = useActiveTrack();

  // Sections (un album = une section) + file de lecture à plat, dérivées ensemble.
  const { sections, queue, albumCount } = useMemo(() => {
    // Vue fusionnée : inclut les collaborations (« X & Y ») de l'artiste, comme la vue Artistes.
    const artistTracks = tracksForMergedArtist(tracks, name);
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

  // Handler stable pour les lignes mémoïsées (cf. TrackIndexRow).
  const playFrom = useCallback(
    (index: number) => void playQueue(queue, index, 'artist'),
    [playQueue, queue]
  );

  // Mode sélection multiple mutualisé : `queue` = toutes les pistes de l'artiste, ordonnées (sert
  // au « Tout » et à l'ordre des actions groupées). `onSelect` révèle « Sélectionner » au long-press.
  const [pickerTracks, setPickerTracks] = useState<LocalTrack[] | null>(null);
  const selection = useTrackSelection(queue, { onAddToPlaylist: setPickerTracks });
  const trackMenu = useTrackActionsMenu({ onSelect: selection.start });
  const quickActions = useTrackQuickActions();

  const [actionsOpen, setActionsOpen] = useState(false);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} />
        {/* Actions d'en-tête regroupées derrière « … » (lot 11). */}
        <Pressable
          onPress={() => setActionsOpen(true)}
          hitSlop={12}
          style={styles.writeButton}
          accessibilityRole="button"
          accessibilityLabel="Actions sur l’artiste"
        >
          <Icon name="more_horiz" size={24} color={colors.textPrimary} />
        </Pressable>
      </View>

      {selection.header}

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
            {name === UNKNOWN_ARTIST && queue.length > 0 && (
              /* Bac « Artiste inconnu » : bandeau explicite vers la revue swipe (miroir du
                 bandeau « Ranger les titres » du bac Album inconnu, cf. album.tsx). */
              <Pressable
                onPress={() => router.push('/sort-unknown-artist')}
                style={({ pressed }) => [styles.identifyBanner, pressed && styles.identifyPressed]}
                accessibilityRole="button"
                accessibilityLabel="Associer les artistes via MusicBrainz"
              >
                <Icon name="auto_fix_high" size={22} color={colors.accentIcon} />
                <View style={styles.identifyBannerText}>
                  <Text style={styles.identifyBannerTitle}>Associer les artistes</Text>
                  <Text style={styles.identifyBannerHint}>
                    Revue titre par titre via MusicBrainz, propositions classées.
                  </Text>
                </View>
                <Icon name="chevron_right" size={22} color={colors.textMuted} />
              </Pressable>
            )}
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
          <SwipeableRow
            onSwipe={() => quickActions.onPlayNext(item)}
            label="Lire ensuite"
            icon="playlist_play"
            enabled={!selection.active}
          >
            <TrackIndexRow
              track={item}
              index={indexById.get(item.id) ?? 0}
              isActive={item.id === activeTrack?.mediaId}
              leadingNumber={item.trackNo ?? index + 1}
              // L'album est déjà dans l'en-tête de section : sous-titre masqué pour ne pas répéter.
              subtitle=""
              onPlay={playFrom}
              onLongPress={trackMenu.open}
              selectionMode={selection.active}
              selected={selection.isSelected(item.id)}
              onToggleSelect={selection.toggle}
              onQuickAction={quickActions.onQuickAction}
              onQuickActionLongPress={quickActions.onQuickActionLongPress}
              isFavorite={quickActions.isFavorite(item.id)}
            />
          </SwipeableRow>
        )}
        windowSize={7}
        ListEmptyComponent={<Text style={styles.empty}>Artiste introuvable.</Text>}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {selection.footer}

      {trackMenu.element}
      {quickActions.element}

      <PlaylistPickerSheet
        tracks={pickerTracks}
        onClose={() => setPickerTracks(null)}
        onAdded={selection.cancel}
      />

      <QuickActionsSheet
        visible={actionsOpen}
        title={name}
        onClose={() => setActionsOpen(false)}
        actions={[
          {
            icon: 'save',
            label: 'Écrire les tags dans les fichiers',
            onPress: () =>
              router.push({
                pathname: '/write-tags',
                params: { scope: 'artist', artist: name, label: name },
              }),
          },
          {
            icon: 'delete_sweep',
            label: 'Nettoyer les titres',
            onPress: () =>
              router.push({ pathname: '/title-cleanup', params: { artist: name, label: name } }),
          },
        ]}
      />
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  writeButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
  identifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  identifyPressed: {
    backgroundColor: colors.background,
  },
  identifyBannerText: {
    flex: 1,
    minWidth: 0,
  },
  identifyBannerTitle: {
    ...typography.heading,
    fontSize: 14,
  },
  identifyBannerHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
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
