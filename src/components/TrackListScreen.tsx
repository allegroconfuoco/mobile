import { useCallback, useMemo, type ReactNode } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme';
import { DetailHero, DetailTopBar, type DetailHeroProps } from '@/components/DetailScreen';
import { TrackListItem } from '@/components/TrackListItem';
import { useTrackListActions, type ExtraSelectionAction } from '@/components/useTrackListActions';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { useActiveTrack } from '@/player/usePlayback';

/** Une section de la liste (un disque d'album, un album d'artiste…). */
export type TrackSection = {
  key: string;
  /** En-tête de section ; absent = pas d'en-tête (liste à section unique). */
  header?: ReactNode;
  data: LocalTrack[];
};

export type TrackListScreenProps = Omit<DetailHeroProps, 'tracks' | 'children'> & {
  /** Pistes dans l'ordre d'affichage. La file de lecture est leur concaténation. */
  sections: TrackSection[];
  /** Boutons de la barre du haut, à droite du retour. */
  topActions?: ReactNode;
  /** Contenu sous les boutons de lecture du héros. */
  heroExtra?: ReactNode;
  /** Numéro et sous-titre d'une ligne (par défaut : pochette + « artiste · album »). */
  rowProps?: (
    track: LocalTrack,
    indexInSection: number
  ) => { leadingNumber?: number | null; subtitle?: string };
  emptyText: string;
  extraAction?: ExtraSelectionAction;
};

/**
 * Écran de détail d'une liste de pistes (album, artiste, favoris, récemment ajoutés) : barre du
 * haut, héros avec « Lire » et « Aléatoire », puis les pistes, éventuellement en sections.
 *
 * Les lignes ont les mêmes gestes partout (cf. `useTrackListActions`) : tap = lire depuis ce
 * titre, « + » = ajouter à, glissement = lire ensuite, appui long = sélection multiple.
 */
export function TrackListScreen({
  sections,
  topActions,
  heroExtra,
  rowProps,
  emptyText,
  extraAction,
  ...hero
}: TrackListScreenProps) {
  const { playQueue } = usePlayer();
  const activeId = useActiveTrack()?.mediaId;

  // File de lecture à plat + index de chaque piste dans cette file.
  const { queue, indexById } = useMemo(() => {
    const flat = sections.flatMap((section) => section.data);
    const map = new Map<string, number>();
    flat.forEach((track, i) => map.set(track.id, i));
    return { queue: flat, indexById: map };
  }, [sections]);

  const actions = useTrackListActions(queue, { extraAction });
  const { selection, onAdd, onPlayNext } = actions;
  const { context, source } = hero;

  const play = useCallback(
    (index: number) => playQueue(queue, index, context, source),
    [playQueue, queue, context, source]
  );

  const selectionMode = selection.active;
  const { isSelected, toggle, start } = selection;
  const renderItem = useCallback(
    ({ item, index }: { item: LocalTrack; index: number }) => {
      const extra = rowProps?.(item, index);
      return (
        <TrackListItem
          track={item}
          index={indexById.get(item.id) ?? 0}
          isActive={item.id === activeId}
          onPlay={play}
          onLongPress={start}
          onAdd={onAdd}
          onPlayNext={onPlayNext}
          selectionMode={selectionMode}
          selected={isSelected(item.id)}
          onToggleSelect={toggle}
          leadingNumber={extra?.leadingNumber}
          subtitle={extra?.subtitle}
        />
      );
    },
    [
      rowProps,
      indexById,
      activeId,
      play,
      start,
      onAdd,
      onPlayNext,
      selectionMode,
      isSelected,
      toggle,
    ]
  );

  return (
    <View style={styles.screen}>
      <DetailTopBar>{topActions}</DetailTopBar>
      {selection.header}
      <SectionList
        sections={sections}
        keyExtractor={(track) => track.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <DetailHero {...hero} tracks={queue}>
            {heroExtra}
          </DetailHero>
        }
        renderSectionHeader={({ section }) => (section.header ? <>{section.header}</> : null)}
        renderItem={renderItem}
        windowSize={9}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
      {selection.footer}
      {actions.element}
    </View>
  );
}

/** En-tête de section texte (« Disque 2 »). */
export function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  empty: {
    ...typography.body,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.accentLabel,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
});
