import { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { BackButton } from '@/components/BackButton';
import { PressableScale } from '@/components/PressableScale';
import { TrackIndexRow, trackRowLayout } from '@/components/TrackRow';
import { useTrackActionsMenu } from '@/components/useTrackActionsMenu';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { useLibrary } from '@/library/LibraryProvider';
import { useFavorites } from '@/library/FavoritesProvider';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/** Écran Favoris : les morceaux likés, jouables comme une file. */
export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracksById, refreshing, rescan } = useLibrary();
  const { favoriteIds } = useFavorites();
  const { playQueue } = usePlayer();
  const { track: activeTrack } = usePlayback();
  const trackMenu = useTrackActionsMenu();

  // Résout les ids favoris en pistes locales, dans l'ordre du `Set` (récent d'abord au démarrage) ;
  // les favoris dont le fichier a disparu de l'appareil sont simplement omis.
  const tracks = useMemo(() => {
    const list: LocalTrack[] = [];
    for (const id of favoriteIds) {
      const track = tracksById.get(id);
      if (track) {
        list.push(track);
      }
    }
    return list;
  }, [favoriteIds, tracksById]);

  // Handler stable pour les lignes mémoïsées (cf. TrackIndexRow).
  const playFrom = useCallback(
    (index: number) => void playQueue(tracks, index, 'favorites'),
    [playQueue, tracks]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <BackButton onPress={() => router.back()} />

      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>Favoris</Text>
          <Text style={styles.title} numberOfLines={2}>
            Morceaux likés
          </Text>
          <Text style={styles.count}>
            {tracks.length} {tracks.length > 1 ? 'titres' : 'titre'}
          </Text>
        </View>
        {tracks.length > 0 && (
          <PressableScale
            haptic
            onPress={() => void playQueue(tracks, 0, 'favorites')}
            style={styles.playButton}
            accessibilityRole="button"
            accessibilityLabel="Lire les favoris"
          >
            <Icon name="play_arrow" size={30} color={colors.onAccent} />
          </PressableScale>
        )}
      </View>

      <FlatList
        data={tracks}
        keyExtractor={(track) => track.id}
        getItemLayout={trackRowLayout}
        windowSize={7}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={rescan}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
        renderItem={({ item, index }) => (
          <TrackIndexRow
            track={item}
            index={index}
            isActive={item.id === activeTrack?.id}
            onPlay={playFrom}
            onLongPress={trackMenu.open}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="favorite_border" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              Aucun favori pour l’instant. Touchez le coeur d’un morceau pour l’ajouter ici.
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {trackMenu.element}
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
    alignItems: 'flex-end',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  eyebrow: {
    ...typography.label,
    color: colors.accentLabel,
  },
  title: {
    ...typography.display,
    marginTop: spacing.sm,
  },
  count: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: 64,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
});
