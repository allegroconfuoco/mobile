import { useMemo, useState } from 'react';
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
import { SegmentedControl, type Segment } from '@/components/SegmentedControl';
import { TrackActionsSheet } from '@/components/TrackActionsSheet';
import { TrackCover } from '@/components/TrackCover';
import { TrackRow } from '@/components/TrackRow';
import type { LibraryStatus, LocalTrack } from '@/library/useAudioLibrary';
import type { AlbumGroup, ArtistGroup, TrackSort } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/** Vue courante de la bibliothèque. */
type LibraryView = 'tracks' | 'artists' | 'albums';

const VIEWS: Segment<LibraryView>[] = [
  { value: 'tracks', label: 'Morceaux' },
  { value: 'artists', label: 'Artistes' },
  { value: 'albums', label: 'Albums' },
];

/** Onglet Bibliothèque : morceaux / artistes / albums de la musique locale. */
export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const { status, tracks, refreshing, error, rescan } = library;
  const [view, setView] = useState<LibraryView>('tracks');

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

      {hasContent ? (
        <LibraryContent view={view} library={library} />
      ) : (
        <LibraryPlaceholder status={status} error={error} library={library} />
      )}
    </View>
  );
}

type LibraryContextValue = ReturnType<typeof useLibrary>;

/** Contenu selon la vue active (bibliothèque prête et non vide). */
function LibraryContent({ view, library }: { view: LibraryView; library: LibraryContextValue }) {
  const { tracks, artists, albums, trackSort, setTrackSort, setTrackExcluded } = library;
  const router = useRouter();
  const { playQueue, playNext, addToQueue } = usePlayer();
  const { track: activeTrack } = usePlayback();
  // Piste dont le menu d'actions (long-press) est ouvert, ou `null` si fermé.
  const [menuTrack, setMenuTrack] = useState<LocalTrack | null>(null);

  return (
    <>
      {view === 'tracks' && (
        <TracksView
          tracks={tracks}
          activeId={activeTrack?.id}
          sort={trackSort}
          onToggleSort={() => setTrackSort(trackSort === 'title' ? 'artist' : 'title')}
          onPlay={(index) => void playQueue(tracks, index)}
          onLongPress={setMenuTrack}
        />
      )}
      {view === 'artists' && (
        <ArtistsView
          artists={artists}
          onOpen={(name) => router.push({ pathname: '/artist', params: { name } })}
        />
      )}
      {view === 'albums' && (
        <AlbumsView
          albums={albums}
          onOpen={(album) =>
            router.push({
              pathname: '/album',
              params: { artist: album.artist, title: album.title },
            })
          }
        />
      )}

      <TrackActionsSheet
        title={menuTrack?.title ?? null}
        onClose={() => setMenuTrack(null)}
        onPlayNext={() => menuTrack && void playNext([menuTrack])}
        onAddToQueue={() => menuTrack && void addToQueue([menuTrack])}
        onExclude={() => menuTrack && setTrackExcluded(menuTrack.id, true)}
      />
    </>
  );
}

/** Vue Morceaux : barre de tri + liste virtualisée. */
function TracksView({
  tracks,
  activeId,
  sort,
  onToggleSort,
  onPlay,
  onLongPress,
}: {
  tracks: LocalTrack[];
  activeId: string | undefined;
  sort: TrackSort;
  onToggleSort: () => void;
  onPlay: (index: number) => void;
  onLongPress: (track: LocalTrack) => void;
}) {
  return (
    <FlatList
      data={tracks}
      keyExtractor={(track) => track.id}
      ListHeaderComponent={<SortBar sort={sort} onToggle={onToggleSort} />}
      renderItem={({ item, index }) => (
        <TrackRow
          track={item}
          isActive={item.id === activeId}
          onPress={() => onPlay(index)}
          onLongPress={() => onLongPress(item)}
        />
      )}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
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

/** Vue Artistes : liste des artistes agrégés. */
function ArtistsView({
  artists,
  onOpen,
}: {
  artists: ArtistGroup[];
  onOpen: (name: string) => void;
}) {
  return (
    <FlatList
      data={artists}
      keyExtractor={(artist) => artist.name}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onOpen(item.name)}
          style={({ pressed }) => [styles.artistRow, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Artiste ${item.name}`}
        >
          <TrackCover uri={item.artworkUri} fallbackIcon="person" />
          <View style={styles.artistText}>
            <Text style={styles.artistName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.artistMeta} numberOfLines={1}>
              {countLabel(item.trackCount, 'titre')} · {countLabel(item.albumCount, 'album')}
            </Text>
          </View>
          <Icon name="chevron_right" size={22} color={colors.textMuted} />
        </Pressable>
      )}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** Vue Albums : grille de pochettes. */
function AlbumsView({
  albums,
  onOpen,
}: {
  albums: AlbumGroup[];
  onOpen: (album: AlbumGroup) => void;
}) {
  return (
    <FlatList
      data={albums}
      keyExtractor={(album) => album.key}
      numColumns={2}
      columnWrapperStyle={styles.albumRow}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onOpen(item)}
          style={styles.albumTile}
          accessibilityRole="button"
          accessibilityLabel={`Album ${item.title}, ${item.artist}`}
        >
          <TrackCover uri={item.artworkUri} fill fallbackIcon="album" />
          <Text style={styles.albumTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.albumArtist} numberOfLines={1}>
            {item.artist}
          </Text>
        </Pressable>
      )}
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
});
