import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import { PressableScale } from '@/components/PressableScale';
import { showToast } from '@/components/Toast';
import { tapLight } from '@/lib/haptics';
import { subscribeTabReselected } from '@/lib/tabs';
import { useRouter } from '@/lib/useRouter';
import type { PlaylistRow } from '@/library/db';
import { useFavorites } from '@/library/FavoritesProvider';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { useSync } from '@/sync/SyncProvider';

import { countLabel, TabHeader, themedRefresh } from './shared';

/** Nombre de titres de la liste automatique « Récemment ajoutés ». */
export const RECENT_LIMIT = 50;

/**
 * Onglet **Playlists** : en tête les deux listes automatiques (Favoris, Récemment ajoutés), puis
 * la création, puis les playlists — la plus récemment modifiée d'abord.
 *
 * Chaque ligne sert deux intentions en un tap : le corps ouvre la playlist, le bouton de droite la
 * lance directement.
 */
export function PlaylistsTab() {
  const router = useRouter();
  const { playlists, createPlaylist, getEntries } = usePlaylistsContext();
  const { favoriteIds } = useFavorites();
  const { tracks, tracksById } = useLibrary();
  const { playQueue } = usePlayer();
  const { status: syncStatus, syncNow } = useSync();
  const [creating, setCreating] = useState(false);

  const listRef = useRef<FlatList<PlaylistRow>>(null);
  useEffect(
    () =>
      subscribeTabReselected((tab) => {
        if (tab === 'playlists') {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }
      }),
    []
  );

  const openPlaylist = useCallback(
    (id: string) => router.push({ pathname: '/playlist', params: { id } }),
    [router]
  );

  // Les pistes d'une playlist ne sont résolues qu'au tap : les charger au rendu ferait une requête
  // par ligne à chaque passage sur l'onglet.
  const playPlaylist = useCallback(
    (playlist: PlaylistRow) => {
      const resolved = getEntries(playlist.id)
        .map((entry) => (entry.localTrackId ? tracksById.get(entry.localTrackId) : undefined))
        .filter((track): track is LocalTrack => track !== undefined);
      if (resolved.length === 0) {
        showToast('Aucun titre disponible dans cette playlist', 'music_off');
        return;
      }
      tapLight();
      playQueue(resolved, 0, `playlist:${playlist.id}`, {
        kind: 'playlist',
        id: playlist.id,
        name: playlist.name,
      });
    },
    [getEntries, tracksById, playQueue]
  );

  const playFavorites = () => {
    const resolved = [...favoriteIds]
      .map((id) => tracksById.get(id))
      .filter((track): track is LocalTrack => track !== undefined);
    if (resolved.length === 0) {
      showToast('Aucun favori pour l’instant', 'favorite');
      return;
    }
    tapLight();
    playQueue(resolved, 0, 'favorites', { kind: 'favorites' });
  };

  const playRecent = () => {
    const recent = recentTracks(tracks);
    if (recent.length === 0) {
      return;
    }
    tapLight();
    playQueue(recent, 0, 'recent', { kind: 'recent' });
  };

  const renderItem = useCallback(
    ({ item }: { item: PlaylistRow }) => (
      <PlaylistItem playlist={item} onOpen={openPlaylist} onPlay={playPlaylist} />
    ),
    [openPlaylist, playPlaylist]
  );

  return (
    <View style={styles.screen}>
      <TabHeader title="Playlists" subtitle={countLabel(playlists.length, 'playlist')} />
      <FlatList
        ref={listRef}
        data={playlists}
        keyExtractor={(playlist) => playlist.id}
        refreshControl={themedRefresh(syncStatus === 'syncing', () => void syncNow())}
        ListHeaderComponent={
          <>
            <Row
              icon="favorite"
              iconFilled
              iconColor={colors.accent}
              label="Favoris"
              hint={countLabel(favoriteIds.size, 'titre')}
              onPress={() => router.push('/favorites')}
              onPlay={playFavorites}
            />
            <Row
              icon="history"
              iconColor={colors.accentIcon}
              label="Récemment ajoutés"
              hint={`Les ${Math.min(RECENT_LIMIT, tracks.length)} derniers titres arrivés`}
              onPress={() => router.push('/recent')}
              onPlay={playRecent}
            />
            <Pressable
              onPress={() => setCreating(true)}
              android_ripple={{ color: colors.borderStrong }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel="Nouvelle playlist"
            >
              <View style={styles.iconBox}>
                <Icon name="add" size={24} color={colors.accentIcon} />
              </View>
              <Text style={[styles.label, styles.createLabel]}>Nouvelle playlist</Text>
            </Pressable>
            <View style={styles.divider} />
          </>
        }
        renderItem={renderItem}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Aucune playlist pour l’instant. Crée-en une ici, ou touche le « + » d’un titre.
          </Text>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <PlaylistNameDialog
        visible={creating}
        title="Nouvelle playlist"
        submitLabel="Créer"
        onSubmit={(name) => openPlaylist(createPlaylist(name))}
        onClose={() => setCreating(false)}
      />
    </View>
  );
}

/** Les derniers titres arrivés sur le téléphone, du plus récent au plus ancien. */
export function recentTracks(tracks: LocalTrack[]): LocalTrack[] {
  return [...tracks].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, RECENT_LIMIT);
}

const PlaylistItem = memo(function PlaylistItem({
  playlist,
  onOpen,
  onPlay,
}: {
  playlist: PlaylistRow;
  onOpen: (id: string) => void;
  onPlay: (playlist: PlaylistRow) => void;
}) {
  return (
    <Row
      icon="queue_music"
      label={playlist.name}
      hint={countLabel(playlist.trackCount, 'titre')}
      onPress={() => onOpen(playlist.id)}
      onPlay={playlist.trackCount > 0 ? () => onPlay(playlist) : undefined}
    />
  );
});

function Row({
  icon,
  iconFilled = false,
  iconColor = colors.textSecondary,
  label,
  hint,
  onPress,
  onPlay,
}: {
  icon: IconName;
  iconFilled?: boolean;
  iconColor?: string;
  label: string;
  hint: string;
  onPress: () => void;
  /** Lance directement la liste. Absent = pas de bouton (playlist vide). */
  onPlay?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.borderStrong }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${hint}`}
    >
      <View style={styles.iconBox}>
        <Icon name={icon} filled={iconFilled} size={22} color={iconColor} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      {onPlay && (
        <PressableScale
          onPress={onPlay}
          hitSlop={6}
          style={styles.play}
          accessibilityRole="button"
          accessibilityLabel={`Lire ${label}`}
        >
          <Icon name="play_arrow" size={26} color={colors.accentIcon} />
        </PressableScale>
      )}
    </Pressable>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingLeft: spacing.xxl,
    paddingRight: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  iconBox: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    ...typography.heading,
  },
  createLabel: {
    color: colors.accentLabel,
  },
  hint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  play: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    marginHorizontal: spacing.xxl,
    marginVertical: spacing.sm,
    backgroundColor: colors.borderFaint,
  },
  empty: {
    ...typography.body,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
  },
});
