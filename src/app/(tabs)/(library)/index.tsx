import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { SearchBar } from '@/components/SearchBar';
import { SegmentedControl, type Segment } from '@/components/SegmentedControl';
import { useTrackActionsMenu } from '@/components/useTrackActionsMenu';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import { TrackCover } from '@/components/TrackCover';
import { TrackIndexRow, trackRowLayout } from '@/components/TrackRow';
import type { LibraryStatus, LocalTrack } from '@/library/useAudioLibrary';
import {
  filterAlbums,
  filterArtists,
  filterTracks,
  normalizeForSearch,
  type AlbumGroup,
  type ArtistGroup,
  type TrackSort,
} from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import { useFavorites } from '@/library/FavoritesProvider';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/** Vue courante de la bibliothèque. */
type LibraryView = 'tracks' | 'artists' | 'albums' | 'playlists';

const VIEWS: Segment<LibraryView>[] = [
  { value: 'tracks', label: 'Morceaux' },
  { value: 'artists', label: 'Artistes' },
  { value: 'albums', label: 'Albums' },
  { value: 'playlists', label: 'Playlists' },
];

/** Placeholder de recherche selon la vue. */
const SEARCH_PLACEHOLDER: Record<LibraryView, string> = {
  tracks: 'Titre, artiste, album',
  artists: 'Rechercher un artiste',
  albums: 'Rechercher un album',
  playlists: 'Rechercher une playlist',
};

/** Onglet Bibliothèque : morceaux / artistes / albums de la musique locale. */
export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const { status, tracks, refreshing, error, rescan } = library;
  const [view, setView] = useState<LibraryView>('tracks');
  const [query, setQuery] = useState('');

  const subtitle = useMemo(() => {
    if (refreshing) {
      return 'Mise à jour…';
    }
    if (status === 'ready' && tracks.length > 0) {
      return `${tracks.length} ${tracks.length > 1 ? 'titres' : 'titre'} sur l'appareil`;
    }
    return 'Musique locale';
  }, [status, tracks.length, refreshing]);

  // La navigation par vue n'a de sens qu'avec une bibliothèque prête et non vide.
  const hasContent = status === 'ready' && !error && tracks.length > 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Bibliothèque</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {status === 'ready' && (
          <Pressable
            onPress={rescan}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Relancer le scan"
          >
            <Icon name="refresh" size={26} color={colors.textPrimary} />
          </Pressable>
        )}
      </View>

      {hasContent && <SegmentedControl segments={VIEWS} value={view} onChange={setView} />}

      {hasContent && (
        <SearchBar value={query} onChangeText={setQuery} placeholder={SEARCH_PLACEHOLDER[view]} />
      )}

      {hasContent ? (
        <LibraryContent view={view} query={query} library={library} />
      ) : (
        <LibraryPlaceholder status={status} error={error} library={library} />
      )}
    </View>
  );
}

type LibraryContextValue = ReturnType<typeof useLibrary>;

/** Contenu selon la vue active (bibliothèque prête et non vide). */
function LibraryContent({
  view,
  query,
  library,
}: {
  view: LibraryView;
  query: string;
  library: LibraryContextValue;
}) {
  const { tracks, artists, albums, trackSort, setTrackSort } = library;
  const router = useRouter();
  const { playQueue } = usePlayer();
  const { track: activeTrack } = usePlayback();
  // Menu d'actions (long-press) mutualisé : ouverture + feuilles rendues via `trackMenu.element`.
  const trackMenu = useTrackActionsMenu();

  // Résultats filtrés par la recherche (temps réel). Requête vide = listes complètes.
  const filteredTracks = useMemo(() => filterTracks(tracks, query), [tracks, query]);
  const filteredArtists = useMemo(() => filterArtists(artists, query), [artists, query]);
  const filteredAlbums = useMemo(() => filterAlbums(albums, query), [albums, query]);

  // Handlers stables (référence conservée entre rendus) : condition pour que le `memo` des lignes
  // de liste soit effectif — une closure recréée à chaque rendu invaliderait toutes les lignes.
  const playFromFiltered = useCallback(
    // La file de lecture reprend exactement la liste filtrée affichée.
    (index: number) => void playQueue(filteredTracks, index),
    [playQueue, filteredTracks]
  );
  const openArtist = useCallback(
    (name: string) => router.push({ pathname: '/artist', params: { name } }),
    [router]
  );
  const openAlbum = useCallback(
    (album: AlbumGroup) =>
      router.push({ pathname: '/album', params: { artist: album.artist, title: album.title } }),
    [router]
  );

  return (
    <>
      {view === 'tracks' && (
        <TracksView
          tracks={filteredTracks}
          query={query}
          activeId={activeTrack?.id}
          sort={trackSort}
          onToggleSort={() => setTrackSort(trackSort === 'title' ? 'artist' : 'title')}
          onPlay={playFromFiltered}
          onLongPress={trackMenu.open}
        />
      )}
      {view === 'artists' && (
        <ArtistsView artists={filteredArtists} query={query} onOpen={openArtist} />
      )}
      {view === 'albums' && <AlbumsView albums={filteredAlbums} query={query} onOpen={openAlbum} />}
      {view === 'playlists' && <PlaylistsView query={query} />}

      {trackMenu.element}
    </>
  );
}

/** Vue Playlists : accès Favoris + liste des playlists (filtrable par nom) + création. */
function PlaylistsView({ query }: { query: string }) {
  const router = useRouter();
  const { playlists, createPlaylist } = usePlaylistsContext();
  const { favoriteIds } = useFavorites();
  const [creating, setCreating] = useState(false);

  // Filtre sur le nom (même repli d'accents que le reste de la recherche).
  const isSearching = normalizeForSearch(query).length > 0;
  const filtered = useMemo(() => {
    const needle = normalizeForSearch(query);
    if (!needle) {
      return playlists;
    }
    return playlists.filter((p) => normalizeForSearch(p.name).includes(needle));
  }, [playlists, query]);

  return (
    <>
      <FlatList
        data={filtered}
        keyExtractor={(playlist) => playlist.id}
        // Pendant une recherche, on masque Favoris + création pour ne montrer que les résultats.
        ListHeaderComponent={
          isSearching ? null : (
            <>
              <Pressable
                onPress={() => router.push('/favorites')}
                style={({ pressed }) => [styles.playlistRow, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel="Favoris"
              >
                <Icon name="favorite" filled size={22} color={colors.accent} />
                <View style={styles.playlistText}>
                  <Text style={styles.playlistName} numberOfLines={1}>
                    Favoris
                  </Text>
                  <Text style={styles.playlistMeta} numberOfLines={1}>
                    {countLabel(favoriteIds.size, 'titre')}
                  </Text>
                </View>
                <Icon name="chevron_right" size={22} color={colors.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => setCreating(true)}
                style={({ pressed }) => [styles.createRow, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel="Nouvelle playlist"
              >
                <Icon name="add" size={24} color={colors.accentIcon} />
                <Text style={styles.createLabel}>Nouvelle playlist</Text>
              </Pressable>
            </>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/playlist', params: { id: item.id } })}
            style={({ pressed }) => [styles.playlistRow, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Playlist ${item.name}`}
          >
            <Icon name="queue_music" size={22} color={colors.textSecondary} />
            <View style={styles.playlistText}>
              <Text style={styles.playlistName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.playlistMeta} numberOfLines={1}>
                {countLabel(item.trackCount, 'titre')}
              </Text>
            </View>
            <Icon name="chevron_right" size={22} color={colors.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={
          isSearching ? (
            <NoResults query={query} />
          ) : (
            <Text style={styles.playlistsEmpty}>
              Aucune playlist pour l’instant. Créez-en une, puis ajoutez des morceaux depuis la
              bibliothèque.
            </Text>
          )
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <PlaylistNameDialog
        visible={creating}
        title="Nouvelle playlist"
        submitLabel="Créer"
        onSubmit={(name) => createPlaylist(name)}
        onClose={() => setCreating(false)}
      />
    </>
  );
}

const trackKey = (track: LocalTrack) => track.id;

/** Vue Morceaux : barre de tri + liste virtualisée. */
function TracksView({
  tracks,
  query,
  activeId,
  sort,
  onToggleSort,
  onPlay,
  onLongPress,
}: {
  tracks: LocalTrack[];
  query: string;
  activeId: string | undefined;
  sort: TrackSort;
  onToggleSort: () => void;
  onPlay: (index: number) => void;
  onLongPress: (track: LocalTrack) => void;
}) {
  const renderItem = useCallback(
    ({ item, index }: { item: LocalTrack; index: number }) => (
      <TrackIndexRow
        track={item}
        index={index}
        isActive={item.id === activeId}
        onPlay={onPlay}
        onLongPress={onLongPress}
      />
    ),
    [activeId, onPlay, onLongPress]
  );

  return (
    <>
      {/* Barre de tri hors liste : hauteur d'items constante → `getItemLayout` exact. On la masque
          quand une recherche ne renvoie rien (seul le message reste). */}
      {!(query && tracks.length === 0) && <SortBar sort={sort} onToggle={onToggleSort} />}
      <FlatList
        data={tracks}
        keyExtractor={trackKey}
        getItemLayout={trackRowLayout}
        renderItem={renderItem}
        windowSize={7}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        ListEmptyComponent={query ? <NoResults query={query} /> : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </>
  );
}

/** Barre de tri de la liste des morceaux (bascule titre / artiste). */
function SortBar({ sort, onToggle }: { sort: TrackSort; onToggle: () => void }) {
  const label = sort === 'title' ? 'Titre' : 'Artiste';
  return (
    <Pressable
      onPress={onToggle}
      style={styles.sortBar}
      accessibilityRole="button"
      accessibilityLabel={`Trier par ${label}. Toucher pour changer.`}
    >
      <Icon name="sort" size={18} color={colors.textSecondary} />
      <Text style={styles.sortLabel}>
        Tri : <Text style={styles.sortValue}>{label}</Text>
      </Text>
    </Pressable>
  );
}

const artistKey = (artist: ArtistGroup) => artist.name;

/** Ligne d'artiste mémoïsée : mêmes hauteur/padding qu'une ligne de piste (44 + 2 × md). */
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
      style={({ pressed }) => [styles.artistRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Artiste ${artist.name}`}
    >
      <TrackCover uri={artist.artworkUri} fallbackIcon="person" seed={artist.name} />
      <View style={styles.artistText}>
        <Text style={styles.artistName} numberOfLines={1}>
          {artist.name}
        </Text>
        <Text style={styles.artistMeta} numberOfLines={1}>
          {countLabel(artist.trackCount, 'titre')} · {countLabel(artist.albumCount, 'album')}
        </Text>
      </View>
      <Icon name="chevron_right" size={22} color={colors.textMuted} />
    </Pressable>
  );
});

/** Vue Artistes : liste des artistes agrégés. */
function ArtistsView({
  artists,
  query,
  onOpen,
}: {
  artists: ArtistGroup[];
  query: string;
  onOpen: (name: string) => void;
}) {
  const renderItem = useCallback(
    ({ item }: { item: ArtistGroup }) => <ArtistRow artist={item} onOpen={onOpen} />,
    [onOpen]
  );

  return (
    <FlatList
      data={artists}
      keyExtractor={artistKey}
      getItemLayout={trackRowLayout}
      windowSize={7}
      initialNumToRender={12}
      maxToRenderPerBatch={16}
      ListEmptyComponent={query ? <NoResults query={query} /> : null}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

const albumKey = (album: AlbumGroup) => album.key;

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
      style={styles.albumTile}
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
      <Text style={styles.albumArtist} numberOfLines={1}>
        {album.artist}
      </Text>
    </Pressable>
  );
});

/** Vue Albums : grille de pochettes. */
function AlbumsView({
  albums,
  query,
  onOpen,
}: {
  albums: AlbumGroup[];
  query: string;
  onOpen: (album: AlbumGroup) => void;
}) {
  const renderItem = useCallback(
    ({ item }: { item: AlbumGroup }) => <AlbumTile album={item} onOpen={onOpen} />,
    [onOpen]
  );

  return (
    <FlatList
      data={albums}
      keyExtractor={albumKey}
      numColumns={2}
      columnWrapperStyle={styles.albumRow}
      windowSize={5}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      ListEmptyComponent={query ? <NoResults query={query} /> : null}
      renderItem={renderItem}
      contentContainerStyle={styles.albumsContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** États hors « prête et non vide » : chargement, permission, vide, erreur. */
function LibraryPlaceholder({
  status,
  error,
  library,
}: {
  status: LibraryStatus;
  error: string | null;
  library: LibraryContextValue;
}) {
  const { requestPermission, rescan } = library;

  switch (status) {
    case 'loading':
    case 'scanning':
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.stateText}>
            {status === 'scanning' ? 'Analyse de la bibliothèque…' : 'Chargement…'}
          </Text>
        </View>
      );

    case 'unsupported':
      return (
        <StateMessage
          icon="library_music"
          text="La bibliothèque locale est disponible depuis l'application Android."
        />
      );

    case 'undetermined':
      return (
        <StateMessage
          icon="library_music"
          text="Fuoco a besoin d'accéder à vos fichiers audio pour construire votre bibliothèque."
          actionLabel="Autoriser l'accès"
          onAction={requestPermission}
        />
      );

    case 'denied':
      return (
        <StateMessage
          icon="lock"
          text="L'accès aux fichiers audio est refusé. Activez-le dans les réglages pour scanner votre musique."
          actionLabel="Ouvrir les réglages"
          onAction={() => void Linking.openSettings()}
        />
      );

    case 'ready':
      if (error) {
        return (
          <StateMessage icon="refresh" text={error} actionLabel="Réessayer" onAction={rescan} />
        );
      }
      return (
        <StateMessage
          icon="library_music"
          text="Aucun fichier audio trouvé sur l'appareil."
          actionLabel="Relancer le scan"
          onAction={rescan}
        />
      );
  }
}

/** Libellé « N titre(s) » / « N album(s) ». */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count > 1 ? 's' : ''}`;
}

/** Message affiché quand une recherche ne renvoie aucun résultat dans la vue courante. */
function NoResults({ query }: { query: string }) {
  return (
    <View style={styles.noResults}>
      <Text style={styles.noResultsText}>Aucun résultat pour « {query.trim()} »</Text>
    </View>
  );
}

type StateMessageProps = {
  icon: IconName;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
};

function StateMessage({ icon, text, actionLabel, onAction }: StateMessageProps) {
  return (
    <View style={styles.centered}>
      <Icon name={icon} size={40} color={colors.textMuted} />
      <Text style={styles.stateText}>{text}</Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.buttonLabel}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.display,
  },
  subtitle: {
    ...typography.label,
    marginTop: spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: 72,
  },
  stateText: {
    ...typography.body,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  buttonLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 14,
    color: colors.onAccent,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  noResults: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
  },
  noResultsText: {
    ...typography.body,
    textAlign: 'center',
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sortLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  sortValue: {
    color: colors.textSecondary,
    fontFamily: typography.heading.fontFamily,
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  artistText: {
    flex: 1,
  },
  artistName: {
    ...typography.heading,
  },
  artistMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  albumsContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
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
  albumTitle: {
    ...typography.heading,
    fontSize: 14,
    marginTop: spacing.sm,
  },
  albumArtist: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
  },
  createLabel: {
    ...typography.heading,
    color: colors.accentLabel,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  playlistText: {
    flex: 1,
    minWidth: 0,
  },
  playlistName: {
    ...typography.heading,
  },
  playlistMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  playlistsEmpty: {
    ...typography.body,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
  },
});
