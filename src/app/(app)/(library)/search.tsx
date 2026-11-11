import { useCallback, useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';
import { TopBarButton } from '@/components/DetailScreen';
import { Icon, type IconName } from '@/components/Icon';
import { SearchBar } from '@/components/SearchBar';
import { TrackCover } from '@/components/TrackCover';
import { TrackListItem } from '@/components/TrackListItem';
import { useTrackListActions } from '@/components/useTrackListActions';
import { DURATION } from '@/lib/motion';
import { useRouter } from '@/lib/useRouter';
import { useAlbums, useArtists } from '@/library/derived';
import {
  filterAlbums,
  filterArtists,
  filterTracks,
  foldKey,
  normalizeForSearch,
} from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { useActiveTrack } from '@/player/usePlayback';

import { countLabel } from '@/tabs/shared';

/** Nombre de résultats montrés par type avant le « Voir les N … ». */
const PREVIEW = 4;

/** Un résultat qui ouvre un écran (artiste, album, playlist). */
type EntityResult = {
  key: string;
  icon: IconName;
  title: string;
  hint: string;
  artworkUri: string | null;
  onPress: () => void;
};

type Section =
  | { key: string; title: string; kind: 'entities'; data: EntityResult[]; more?: () => void }
  | { key: string; title: string; kind: 'tracks'; data: LocalTrack[] };

/**
 * Recherche globale : un seul champ, qui cherche dans les titres, les artistes, les albums et les
 * playlists à la fois. Les résultats sont groupés par type — artistes, albums et playlists en
 * premier (quelques-uns, on les reconnaît vite), puis tous les titres correspondants.
 *
 * La recherche ignore la casse et les accents (« beyonce » trouve « Beyoncé »). La saisie reste
 * fluide même sur une grosse bibliothèque : le filtrage suit la frappe avec un temps de retard
 * (`useDeferredValue`), sans jamais bloquer le clavier.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracks } = useLibrary();
  const artists = useArtists();
  const albums = useAlbums();
  const { playlists } = usePlaylistsContext();
  const { playQueue } = usePlayer();
  const activeId = useActiveTrack()?.mediaId;

  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const needle = normalizeForSearch(deferred);
  const [expanded, setExpanded] = useState<'artists' | 'albums' | null>(null);

  const results = useMemo(() => {
    if (!needle) {
      return null;
    }
    return {
      tracks: filterTracks(tracks, deferred),
      artists: filterArtists(artists, deferred),
      albums: filterAlbums(albums, deferred),
      playlists: playlists.filter((p) => foldKey(p.name).includes(needle)),
    };
  }, [needle, deferred, tracks, artists, albums, playlists]);

  const matchedTracks = useMemo(() => results?.tracks ?? [], [results]);
  const actions = useTrackListActions(matchedTracks);
  const { selection, onAdd, onPlayNext } = actions;

  const sections = useMemo<Section[]>(() => {
    if (!results) {
      return [];
    }
    const out: Section[] = [];
    if (results.artists.length > 0) {
      const all = expanded === 'artists';
      out.push({
        key: 'artists',
        title: 'Artistes',
        kind: 'entities',
        data: (all ? results.artists : results.artists.slice(0, PREVIEW)).map((a) => ({
          key: `artist-${a.name}`,
          icon: 'person',
          title: a.name,
          hint: countLabel(a.trackCount, 'titre'),
          artworkUri: a.artworkUri,
          onPress: () => router.push({ pathname: '/artist', params: { name: a.name } }),
        })),
        more: !all && results.artists.length > PREVIEW ? () => setExpanded('artists') : undefined,
      });
    }
    if (results.albums.length > 0) {
      const all = expanded === 'albums';
      out.push({
        key: 'albums',
        title: 'Albums',
        kind: 'entities',
        data: (all ? results.albums : results.albums.slice(0, PREVIEW)).map((a) => ({
          key: `album-${a.key}`,
          icon: 'album',
          title: a.title,
          hint: a.artist,
          artworkUri: a.artworkUri,
          onPress: () =>
            router.push({ pathname: '/album', params: { artist: a.artist, title: a.title } }),
        })),
        more: !all && results.albums.length > PREVIEW ? () => setExpanded('albums') : undefined,
      });
    }
    if (results.playlists.length > 0) {
      out.push({
        key: 'playlists',
        title: 'Playlists',
        kind: 'entities',
        data: results.playlists.map((p) => ({
          key: `playlist-${p.id}`,
          icon: 'queue_music',
          title: p.name,
          hint: countLabel(p.trackCount, 'titre'),
          artworkUri: null,
          onPress: () => router.push({ pathname: '/playlist', params: { id: p.id } }),
        })),
      });
    }
    if (results.tracks.length > 0) {
      out.push({
        key: 'tracks',
        title: `Titres · ${results.tracks.length}`,
        kind: 'tracks',
        data: results.tracks,
      });
    }
    return out;
  }, [results, expanded, router]);

  const play = useCallback(
    (index: number) => {
      Keyboard.dismiss();
      playQueue(matchedTracks, index, 'search');
    },
    [playQueue, matchedTracks]
  );

  const selectionMode = selection.active;
  const { isSelected, toggle, start } = selection;
  const renderTrack = useCallback(
    (track: LocalTrack, index: number) => (
      <TrackListItem
        track={track}
        index={index}
        isActive={track.id === activeId}
        onPlay={play}
        onLongPress={start}
        onAdd={onAdd}
        onPlayNext={onPlayNext}
        selectionMode={selectionMode}
        selected={isSelected(track.id)}
        onToggleSelect={toggle}
      />
    ),
    [activeId, play, start, onAdd, onPlayNext, selectionMode, isSelected, toggle]
  );

  const changeQuery = (text: string) => {
    setQuery(text);
    setExpanded(null);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xs }]}>
      <View style={styles.top}>
        <TopBarButton icon="arrow_back" label="Retour" onPress={() => router.back()} />
        <View style={styles.field}>
          <SearchBar
            value={query}
            onChangeText={changeQuery}
            placeholder="Titres, artistes, albums, playlists"
            autoFocus
          />
        </View>
      </View>

      {selection.header}

      {results === null ? (
        <Hint icon="search" text="Cherche un titre, un artiste, un album ou une playlist." />
      ) : sections.length === 0 ? (
        <Hint icon="music_off" text={`Aucun résultat pour « ${deferred.trim()} »`} />
      ) : (
        <SectionList<LocalTrack | EntityResult, Section>
          sections={sections}
          keyExtractor={(item) => ('key' in item ? item.key : item.id)}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderSectionHeader={({ section }) => <SectionTitle label={section.title} />}
          renderSectionFooter={({ section }) =>
            section.kind === 'entities' && section.more ? (
              <Pressable
                onPress={section.more}
                style={styles.more}
                accessibilityRole="button"
                accessibilityLabel={`Voir tous les ${section.title.toLowerCase()}`}
              >
                <Text style={styles.moreLabel}>Voir tout</Text>
                <Icon name="expand_more" size={18} color={colors.accentLabel} />
              </Pressable>
            ) : null
          }
          renderItem={({ item, index, section }) =>
            section.kind === 'tracks' ? (
              renderTrack(item as LocalTrack, index)
            ) : (
              <EntityRow result={item as EntityResult} />
            )
          }
          windowSize={9}
          initialNumToRender={14}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {selection.footer}
      {actions.element}
    </View>
  );
}

function SectionTitle({ label }: { label: string }) {
  return <Text style={styles.sectionTitle}>{label}</Text>;
}

function EntityRow({ result }: { result: EntityResult }) {
  return (
    <Pressable
      onPress={() => {
        Keyboard.dismiss();
        result.onPress();
      }}
      android_ripple={{ color: colors.borderStrong }}
      style={styles.entity}
      accessibilityRole="button"
      accessibilityLabel={`${result.title}, ${result.hint}`}
    >
      <TrackCover uri={result.artworkUri} fallbackIcon={result.icon} seed={result.title} />
      <View style={styles.entityText}>
        <Text style={styles.entityTitle} numberOfLines={1}>
          {result.title}
        </Text>
        <Text style={styles.entityHint} numberOfLines={1}>
          {result.hint}
        </Text>
      </View>
      <Icon name="chevron_right" size={22} color={colors.textMuted} />
    </Pressable>
  );
}

function Hint({ icon, text }: { icon: IconName; text: ReactNode }) {
  return (
    <Animated.View entering={FadeIn.duration(DURATION.base)} style={styles.hint}>
      <Icon name={icon} size={36} color={colors.textMuted} />
      <Text style={styles.hintText}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
  },
  field: {
    flex: 1,
    minWidth: 0,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.accentLabel,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  entity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.xxl,
    paddingRight: spacing.lg,
    paddingVertical: spacing.md,
  },
  entityText: {
    flex: 1,
    minWidth: 0,
  },
  entityTitle: {
    ...typography.heading,
  },
  entityHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
  },
  moreLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 13,
    color: colors.accentLabel,
  },
  hint: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: 96,
  },
  hintText: {
    ...typography.body,
    textAlign: 'center',
  },
});
