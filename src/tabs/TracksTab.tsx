import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { TrackListItem } from '@/components/TrackListItem';
import { trackRowLayout } from '@/components/TrackRow';
import { useTrackListActions } from '@/components/useTrackListActions';
import { tapLight } from '@/lib/haptics';
import { subscribeTabReselected } from '@/lib/tabs';
import { type TrackSort } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlaybackMode, usePlayer } from '@/player/PlayerProvider';
import { useActiveTrack } from '@/player/usePlayback';
import { useSync } from '@/sync/SyncProvider';

import { countLabel, LibraryGate, TabHeader, themedRefresh } from './shared';

/** Critères de tri, dans l'ordre d'affichage de la feuille. */
const SORT_OPTIONS: { key: TrackSort; label: string; icon: IconName }[] = [
  { key: 'title', label: 'Titre', icon: 'sort' },
  { key: 'artist', label: 'Artiste', icon: 'person' },
  { key: 'recent', label: 'Ajouts récents', icon: 'history' },
];

const trackKey = (track: LocalTrack) => track.id;

/**
 * Onglet **Morceaux** — l'écran d'ouverture de l'app : toute la bibliothèque dans une seule liste.
 *
 * Un tap lit le titre (la file étant la liste telle qu'affichée), le « + » le range dans une
 * playlist, un glissement vers la droite le place en « Lire ensuite », un appui long ouvre la
 * sélection multiple. Tirer la liste vers le bas re-scanne les fichiers et synchronise.
 */
export function TracksTab() {
  const { status, tracks, trackSort, setTrackSort, refreshing, rescan } = useLibrary();
  const { playQueue } = usePlayer();
  const { shuffle, toggleShuffle } = usePlaybackMode();
  const { status: syncStatus, syncNow } = useSync();
  const activeId = useActiveTrack()?.mediaId;
  const actions = useTrackListActions(tracks);
  const { selection, onAdd, onPlayNext } = actions;
  const [sortSheet, setSortSheet] = useState(false);

  const listRef = useRef<FlatList<LocalTrack>>(null);
  // Retoucher l'onglet déjà actif remonte en haut de la liste.
  useEffect(
    () =>
      subscribeTabReselected((tab) => {
        if (tab === 'tracks') {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }
      }),
    []
  );

  const refreshAll = useCallback(() => {
    rescan();
    void syncNow();
  }, [rescan, syncNow]);

  // Handlers stables : condition pour que le `memo` des lignes serve à quelque chose.
  const play = useCallback(
    (index: number) => playQueue(tracks, index, 'library'),
    [playQueue, tracks]
  );

  const playShuffled = () => {
    if (tracks.length === 0) {
      return;
    }
    tapLight();
    // Le mode aléatoire est un réglage persistant : on l'active s'il ne l'est pas, pour que
    // l'écran Lecture et la file reflètent ce qui se joue vraiment.
    if (!shuffle) {
      toggleShuffle();
    }
    playQueue(tracks, Math.floor(Math.random() * tracks.length), 'library');
  };

  const selectionMode = selection.active;
  const { isSelected, toggle, start } = selection;
  const renderItem = useCallback(
    ({ item, index }: { item: LocalTrack; index: number }) => (
      <TrackListItem
        track={item}
        index={index}
        isActive={item.id === activeId}
        onPlay={play}
        onLongPress={start}
        onAdd={onAdd}
        onPlayNext={onPlayNext}
        selectionMode={selectionMode}
        selected={isSelected(item.id)}
        onToggleSelect={toggle}
      />
    ),
    [activeId, play, start, onAdd, onPlayNext, selectionMode, isSelected, toggle]
  );

  const ready = status === 'ready' && tracks.length > 0;
  const subtitle = refreshing
    ? 'Mise à jour…'
    : ready
      ? `${countLabel(tracks.length, 'titre')} sur l'appareil`
      : 'Musique locale';
  const sortLabel = SORT_OPTIONS.find((o) => o.key === trackSort)?.label ?? 'Titre';

  return (
    <View style={styles.screen}>
      <TabHeader title="Morceaux" subtitle={subtitle} />

      {ready ? (
        <>
          {/* Barre d'outils hors liste : hauteur de lignes constante → `getItemLayout` exact. En
              mode sélection, elle cède la place à la barre de sélection. */}
          {selectionMode ? (
            selection.header
          ) : (
            <View style={styles.toolbar}>
              <Pressable
                onPress={() => setSortSheet(true)}
                hitSlop={8}
                style={styles.sort}
                accessibilityRole="button"
                accessibilityLabel={`Trier par ${sortLabel}. Toucher pour choisir un autre tri.`}
              >
                <Icon name="sort" size={18} color={colors.textSecondary} />
                <Text style={styles.sortLabel}>{sortLabel}</Text>
                <Icon name="expand_more" size={18} color={colors.textMuted} />
              </Pressable>
              <PressableScale
                onPress={playShuffled}
                style={styles.shuffle}
                accessibilityRole="button"
                accessibilityLabel="Lire toute la bibliothèque en aléatoire"
              >
                <Icon name="shuffle" size={18} color={colors.onAccent} />
                <Text style={styles.shuffleLabel}>Aléatoire</Text>
              </PressableScale>
            </View>
          )}
          <FlatList
            ref={listRef}
            data={tracks}
            keyExtractor={trackKey}
            getItemLayout={trackRowLayout}
            renderItem={renderItem}
            windowSize={9}
            initialNumToRender={10}
            maxToRenderPerBatch={12}
            updateCellsBatchingPeriod={32}
            removeClippedSubviews
            refreshControl={
              selectionMode
                ? undefined
                : themedRefresh(refreshing || syncStatus === 'syncing', refreshAll)
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
          {selection.footer}
        </>
      ) : (
        <LibraryGate />
      )}

      {actions.element}

      <BottomSheet
        visible={sortSheet}
        onClose={() => setSortSheet(false)}
        title="Trier les morceaux"
      >
        {SORT_OPTIONS.map((option) => {
          const current = option.key === trackSort;
          return (
            <Pressable
              key={option.key}
              onPress={() => {
                setSortSheet(false);
                setTrackSort(option.key);
                listRef.current?.scrollToOffset({ offset: 0, animated: false });
              }}
              android_ripple={{ color: colors.borderStrong }}
              style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: current }}
              accessibilityLabel={option.label}
            >
              <Icon name={option.icon} size={22} color={colors.accentIcon} />
              <Text style={styles.sheetLabel}>{option.label}</Text>
              {current && <Icon name="check" size={20} color={colors.accent} />}
            </Pressable>
          );
        })}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    paddingLeft: spacing.xxl,
    paddingRight: spacing.lg,
  },
  sort: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sortLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 13,
    color: colors.textSecondary,
  },
  shuffle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 30,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  shuffleLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 12.5,
    color: colors.onAccent,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  // Même gabarit que les autres feuilles : elles doivent être indiscernables à l'œil.
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radii.sm,
  },
  sheetRowPressed: {
    backgroundColor: colors.background,
  },
  sheetLabel: {
    ...typography.heading,
    flex: 1,
    fontSize: 15,
  },
});
