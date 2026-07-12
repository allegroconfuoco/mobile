import { memo, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from '@/lib/useRouter';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { SearchBar } from '@/components/SearchBar';
import { SegmentedControl, type Segment } from '@/components/SegmentedControl';
import { showToast } from '@/components/Toast';
import { useTrackActionsMenu } from '@/components/useTrackActionsMenu';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { tapLight } from '@/lib/haptics';
import { ResumeCard } from '@/components/ResumeCard';
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
import { useSync } from '@/sync/SyncProvider';
import { usePlayer } from '@/player/PlayerProvider';
import { useActiveTrack } from '@/player/usePlayback';

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
  const router = useRouter();
  const library = useLibrary();
  const { status, tracks, refreshing, error, rescan } = library;
  const { lastSync } = useSync();
  const [view, setView] = useState<LibraryView>('tracks');
  const [query, setQuery] = useState('');

  // Indicateur hors-ligne discret (lot 6) : la dernière tentative de synchro a échoué.
  const syncTrouble = lastSync !== null && lastSync.result !== 'ok';

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
        {syncTrouble && (
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={12}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Synchronisation en attente — ouvrir les réglages"
          >
            <Icon name="cloud_off" size={24} color={colors.textMuted} />
          </Pressable>
        )}
        {status === 'ready' && (
          <Pressable
            onPress={rescan}
            hitSlop={12}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Relancer le scan"
          >
            <Icon name="refresh" size={26} color={colors.textPrimary} />
          </Pressable>
        )}
      </View>

      {/* Reprise inter-appareils (#25) : bannière si un autre appareil a laissé une écoute en cours. */}
      {hasContent && <ResumeCard />}

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
/** RefreshControl aux couleurs Forge (pull-to-refresh). */
function themedRefresh(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surface}
    />
  );
}

/** Cycle de tri des morceaux : titre → artiste → ajouts récents. */
function nextSort(sort: TrackSort): TrackSort {
  if (sort === 'title') {
    return 'artist';
  }
  if (sort === 'artist') {
    return 'recent';
  }
  return 'title';
}

function LibraryContent({
  view,
  query,
  library,
}: {
  view: LibraryView;
  query: string;
  library: LibraryContextValue;
}) {
  const { tracks, artists, albums, trackSort, setTrackSort, refreshing, rescan } = library;
  const router = useRouter();
  const { playQueue, playNext, addToQueue } = usePlayer();
  const { status: syncStatus, syncNow } = useSync();
  const activeTrack = useActiveTrack();

  // Pull-to-refresh unifié (passe UX) : le même geste voulait dire « re-scanner les fichiers »
  // sur Morceaux/Artistes/Albums mais « synchroniser » sur Playlists — sémantique invisible.
  // Désormais tirer = tout rafraîchir (re-scan incrémental + synchro), partout.
  const refreshAll = useCallback(() => {
    rescan();
    void syncNow();
  }, [rescan, syncNow]);
  const pulling = refreshing || syncStatus === 'syncing';

  // Mode sélection multiple (vue Morceaux) : `null` = mode normal. Entré via l'action
  // « Sélectionner » du menu long-press, sorti par « Annuler » ou après une action réussie.
  const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
  // Pistes en attente dans le sélecteur de playlist (action groupée du mode sélection).
  const [pickerTracks, setPickerTracks] = useState<LocalTrack[] | null>(null);

  const startSelection = useCallback((track: LocalTrack) => setSelection(new Set([track.id])), []);
  // Menu d'actions (long-press) mutualisé : ouverture + feuilles rendues via `trackMenu.element`.
  const trackMenu = useTrackActionsMenu({ onSelect: startSelection });

  // Résultats filtrés par la recherche (temps réel). Requête vide = listes complètes.
  const filteredTracks = useMemo(() => filterTracks(tracks, query), [tracks, query]);
  const filteredArtists = useMemo(() => filterArtists(artists, query), [artists, query]);
  const filteredAlbums = useMemo(() => filterAlbums(albums, query), [albums, query]);

  const toggleSelect = useCallback((track: LocalTrack) => {
    setSelection((prev) => {
      if (!prev) {
        return prev;
      }
      const next = new Set(prev);
      if (next.has(track.id)) {
        next.delete(track.id);
      } else {
        next.add(track.id);
      }
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => setSelection(null), []);

  // Pistes sélectionnées dans l'ordre d'affichage courant (tri de la bibliothèque), pas dans
  // l'ordre des taps : « Lire ensuite » sur 10 titres doit respecter l'ordre de la liste.
  const selectedTracks = useMemo(
    () => (selection ? tracks.filter((t) => selection.has(t.id)) : []),
    [tracks, selection]
  );

  const playNextSelected = () => {
    if (selectedTracks.length > 0) {
      tapLight();
      void playNext(selectedTracks);
      showToast(
        selectedTracks.length > 1
          ? `${selectedTracks.length} titres liront ensuite`
          : 'Lira ensuite',
        'queue_music'
      );
      setSelection(null);
    }
  };

  const addSelectedToQueue = () => {
    if (selectedTracks.length > 0) {
      tapLight();
      void addToQueue(selectedTracks);
      showToast(
        selectedTracks.length > 1
          ? `${selectedTracks.length} titres ajoutés à la file`
          : 'Ajouté à la file',
        'queue_music'
      );
      setSelection(null);
    }
  };

  // Handlers stables (référence conservée entre rendus) : condition pour que le `memo` des lignes
  // de liste soit effectif — une closure recréée à chaque rendu invaliderait toutes les lignes.
  const playFromFiltered = useCallback(
    // La file de lecture reprend exactement la liste filtrée affichée. Contexte d'écoute (#25) :
    // un lancement depuis une liste filtrée est une « recherche », sinon la bibliothèque.
    (index: number) =>
      void playQueue(filteredTracks, index, query.trim() !== '' ? 'search' : 'library'),
    [playQueue, filteredTracks, query]
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
          activeId={activeTrack?.mediaId}
          sort={trackSort}
          onToggleSort={() => setTrackSort(nextSort(trackSort))}
          onPlay={playFromFiltered}
          onLongPress={trackMenu.open}
          refreshing={pulling}
          onRefresh={refreshAll}
          selection={selection}
          onToggleSelect={toggleSelect}
          onSelectionChange={setSelection}
          onCancelSelection={cancelSelection}
          onAddSelectedToPlaylist={() => setPickerTracks(selectedTracks)}
          onPlayNextSelected={playNextSelected}
          onAddSelectedToQueue={addSelectedToQueue}
        />
      )}
      {view === 'artists' && (
        <ArtistsView
          artists={filteredArtists}
          query={query}
          onOpen={openArtist}
          refreshing={pulling}
          onRefresh={refreshAll}
        />
      )}
      {view === 'albums' && (
        <AlbumsView
          albums={filteredAlbums}
          query={query}
          onOpen={openAlbum}
          refreshing={pulling}
          onRefresh={refreshAll}
        />
      )}
      {view === 'playlists' && (
        <PlaylistsView query={query} refreshing={pulling} onRefresh={refreshAll} />
      )}

      {trackMenu.element}

      {/* Sélecteur de playlist du mode sélection (multi-titres) : distinct de celui du menu
          long-press (une seule piste), la sortie du mode ne se fait qu'après un ajout réussi. */}
      <PlaylistPickerSheet
        tracks={pickerTracks}
        onClose={() => setPickerTracks(null)}
        onAdded={cancelSelection}
      />
    </>
  );
}

/** Vue Playlists : accès Favoris + liste des playlists (filtrable par nom) + création. */
function PlaylistsView({
  query,
  refreshing,
  onRefresh,
}: {
  query: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
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
        refreshControl={themedRefresh(refreshing, onRefresh)}
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

/** Vue Morceaux : barre de tri + liste virtualisée, avec un mode sélection multiple. */
function TracksView({
  tracks,
  query,
  activeId,
  sort,
  onToggleSort,
  onPlay,
  onLongPress,
  refreshing,
  onRefresh,
  selection,
  onToggleSelect,
  onSelectionChange,
  onCancelSelection,
  onAddSelectedToPlaylist,
  onPlayNextSelected,
  onAddSelectedToQueue,
}: {
  tracks: LocalTrack[];
  query: string;
  activeId: string | undefined;
  sort: TrackSort;
  onToggleSort: () => void;
  onPlay: (index: number) => void;
  onLongPress: (track: LocalTrack) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Ids sélectionnés, ou `null` hors mode sélection. */
  selection: ReadonlySet<string> | null;
  onToggleSelect: (track: LocalTrack) => void;
  onSelectionChange: (next: ReadonlySet<string>) => void;
  onCancelSelection: () => void;
  onAddSelectedToPlaylist: () => void;
  onPlayNextSelected: () => void;
  onAddSelectedToQueue: () => void;
}) {
  const selectionMode = selection !== null;

  const renderItem = useCallback(
    ({ item, index }: { item: LocalTrack; index: number }) => (
      <TrackIndexRow
        track={item}
        index={index}
        isActive={item.id === activeId}
        onPlay={onPlay}
        onLongPress={selectionMode ? undefined : onLongPress}
        selectionMode={selectionMode}
        selected={selection?.has(item.id) ?? false}
        onToggleSelect={onToggleSelect}
      />
    ),
    [activeId, onPlay, onLongPress, selectionMode, selection, onToggleSelect]
  );

  // « Tout » porte sur la liste affichée (donc filtrée) ; re-tap = tout désélectionner.
  const allVisibleSelected =
    selectionMode && tracks.length > 0 && tracks.every((t) => selection.has(t.id));
  const toggleAllVisible = () => {
    if (!selectionMode) {
      return;
    }
    const next = new Set(selection);
    if (allVisibleSelected) {
      for (const t of tracks) {
        next.delete(t.id);
      }
    } else {
      for (const t of tracks) {
        next.add(t.id);
      }
    }
    onSelectionChange(next);
  };

  const count = selection?.size ?? 0;

  return (
    <>
      {/* Barre de tri hors liste : hauteur d'items constante → `getItemLayout` exact. On la masque
          quand une recherche ne renvoie rien (seul le message reste). En mode sélection, elle cède
          la place à la barre de sélection (compteur + Tout + Annuler). */}
      {selectionMode ? (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionCount}>
            {count} sélectionné{count > 1 ? 's' : ''}
          </Text>
          <Pressable
            onPress={toggleAllVisible}
            hitSlop={8}
            style={styles.selectionAction}
            accessibilityRole="button"
          >
            <Text style={styles.selectionActionLabel}>{allVisibleSelected ? 'Aucun' : 'Tout'}</Text>
          </Pressable>
          <Pressable
            onPress={onCancelSelection}
            hitSlop={8}
            style={styles.selectionAction}
            accessibilityRole="button"
          >
            <Text style={styles.selectionActionLabel}>Annuler</Text>
          </Pressable>
        </View>
      ) : (
        !(query && tracks.length === 0) && <SortBar sort={sort} onToggle={onToggleSort} />
      )}
      <FlatList
        data={tracks}
        keyExtractor={trackKey}
        getItemLayout={trackRowLayout}
        renderItem={renderItem}
        windowSize={7}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        refreshControl={selectionMode ? undefined : themedRefresh(refreshing, onRefresh)}
        ListEmptyComponent={query ? <NoResults query={query} /> : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
      {selectionMode && (
        <View style={styles.selectionFooter}>
          <SelectionFooterAction
            icon="playlist_add_check"
            label="Playlist"
            disabled={count === 0}
            onPress={onAddSelectedToPlaylist}
          />
          <SelectionFooterAction
            icon="playlist_play"
            label="Lire ensuite"
            disabled={count === 0}
            onPress={onPlayNextSelected}
          />
          <SelectionFooterAction
            icon="playlist_add"
            label="File"
            disabled={count === 0}
            onPress={onAddSelectedToQueue}
          />
        </View>
      )}
    </>
  );
}

/** Action de la barre du mode sélection (icône + libellé court, désactivée si sélection vide). */
function SelectionFooterAction({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.selectionFooterAction,
        pressed && styles.rowPressed,
        disabled && styles.selectionFooterDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Icon name={icon} size={22} color={colors.accentIcon} />
      <Text style={styles.selectionFooterLabel}>{label}</Text>
    </Pressable>
  );
}

/** Barre de tri de la liste des morceaux (cycle titre / artiste / ajouts récents). */
function SortBar({ sort, onToggle }: { sort: TrackSort; onToggle: () => void }) {
  const label = sort === 'title' ? 'Titre' : sort === 'artist' ? 'Artiste' : 'Ajouts récents';
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
  refreshing,
  onRefresh,
}: {
  artists: ArtistGroup[];
  query: string;
  onOpen: (name: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
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
      refreshControl={themedRefresh(refreshing, onRefresh)}
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
  refreshing,
  onRefresh,
}: {
  albums: AlbumGroup[];
  query: string;
  onOpen: (album: AlbumGroup) => void;
  refreshing: boolean;
  onRefresh: () => void;
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
      refreshControl={themedRefresh(refreshing, onRefresh)}
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
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  headerAction: {
    paddingTop: spacing.xs,
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
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  selectionCount: {
    ...typography.heading,
    fontSize: 14,
    flex: 1,
  },
  selectionAction: {
    paddingVertical: spacing.xs,
  },
  selectionActionLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 13,
    color: colors.accentLabel,
  },
  selectionFooter: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  selectionFooterAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.md,
  },
  selectionFooterDisabled: {
    opacity: 0.4,
  },
  selectionFooterLabel: {
    ...typography.body,
    fontSize: 11.5,
    color: colors.textSecondary,
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
