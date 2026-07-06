import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';

import { colors, coverFallback, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';

/**
 * Liste de pistes réordonnable par glisser-déposer, sans dépendance native.
 *
 * `Animated` + `PanResponder` du cœur de React Native (pas de reanimated/gesture-handler, non
 * configurés — cf. CLAUDE.md sur les deps natives fragiles). Le geste part d'une **poignée** dédiée
 * pour ne pas entrer en conflit avec le tap (qui saute à la piste) ni avec le défilement.
 *
 * Rendu à position absolue sur une grille de hauteur fixe (`ROW_HEIGHT`) : la ligne tirée suit le
 * doigt, les autres s'écartent. Au lâcher, on réordonne localement (optimiste) puis on remonte le
 * déplacement via `onMove`.
 *
 * Générique (file d'attente *et* détail de playlist) : les items sont normalisés en
 * `DraggableTrackItem`, chaque appelant projette son type source (RNTP `Track`, `LocalTrack`…).
 */

const ROW_HEIGHT = 64;

/** Forme minimale attendue par la liste : chaque appelant y projette son type source. */
export type DraggableTrackItem = {
  id: string;
  title: string;
  artist: string;
  /** URI de pochette, ou `null` (pastille de repli). */
  artworkUri: string | null;
};

export type DraggableTrackListProps = {
  items: DraggableTrackItem[];
  /** Id de la piste en cours (surlignage) ; robuste aux réordonnancements, contrairement à un index. */
  activeTrackId: string | undefined;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  /** Libellé d'accessibilité de l'action « retirer » (ex. « Retirer de la file »). */
  removeLabel?: string;
  contentPaddingBottom?: number;
};

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function DraggableTrackList({
  items,
  activeTrackId,
  onPlay,
  onRemove,
  onMove,
  removeLabel = 'Retirer',
  contentPaddingBottom = 0,
}: DraggableTrackListProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const pan = useMemo(() => new Animated.Value(0), []);

  // Ordre affiché : source de vérité pendant un glisser (optimiste, posé au lâcher). On le
  // resynchronise sur `items` hors glisser, via le motif React « ajuster l'état pendant le
  // rendu » (pas d'effet) : ça évite de resauter si un refresh arrive en plein geste, et supprime
  // tout flash entre le lâcher optimiste et la confirmation.
  const [data, setData] = useState<DraggableTrackItem[]>(items);
  const [syncedItems, setSyncedItems] = useState<DraggableTrackItem[]>(items);
  if (items !== syncedItems && draggingIndex === null) {
    setSyncedItems(items);
    setData(items);
  }

  const startDrag = (index: number) => {
    pan.setValue(0);
    setDraggingIndex(index);
    setHoverIndex(index);
  };

  const moveDrag = (index: number, dy: number) => {
    pan.setValue(dy);
    const next = clamp(Math.round(index + dy / ROW_HEIGHT), 0, data.length - 1);
    setHoverIndex((current) => (current === next ? current : next));
  };

  const endDrag = (index: number) => {
    const to = hoverIndex ?? index;
    if (to !== index) {
      setData((current) => arrayMove(current, index, to));
      onMove(index, to);
    }
    pan.setValue(0);
    setDraggingIndex(null);
    setHoverIndex(null);
  };

  return (
    <ScrollView
      scrollEnabled={draggingIndex === null}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ height: data.length * ROW_HEIGHT + contentPaddingBottom }}
    >
      {data.map((item, index) => (
        <DraggableRow
          key={`${item.id}-${index}`}
          item={item}
          index={index}
          isActive={item.id === activeTrackId}
          isDragging={index === draggingIndex}
          offset={rowOffset(index, draggingIndex, hoverIndex)}
          dragTranslate={pan}
          removeLabel={removeLabel}
          onStartDrag={startDrag}
          onMoveDrag={moveDrag}
          onEndDrag={endDrag}
          onPlay={() => onPlay(index)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ScrollView>
  );
}

/** Décalage vertical d'une ligne non tirée, pour ouvrir l'emplacement visé. */
function rowOffset(index: number, dragging: number | null, hover: number | null): number {
  if (dragging === null || hover === null || index === dragging) {
    return 0;
  }
  if (dragging < hover && index > dragging && index <= hover) {
    return -ROW_HEIGHT;
  }
  if (dragging > hover && index < dragging && index >= hover) {
    return ROW_HEIGHT;
  }
  return 0;
}

type DraggableRowProps = {
  item: DraggableTrackItem;
  index: number;
  isActive: boolean;
  isDragging: boolean;
  offset: number;
  dragTranslate: Animated.Value;
  removeLabel: string;
  onStartDrag: (index: number) => void;
  onMoveDrag: (index: number, dy: number) => void;
  onEndDrag: (index: number) => void;
  onPlay: () => void;
  onRemove: () => void;
};

function DraggableRow(props: DraggableRowProps) {
  // Le PanResponder est créé une fois ; il lit les valeurs courantes via une ref (mise à jour hors
  // rendu, dans un effet) pour rester juste après un réordonnancement — l'index de la ligne change
  // alors sans qu'on ait à recréer le responder.
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  // `propsRef` n'est lue que dans les handlers de geste (jamais pendant le rendu) : motif standard
  // PanResponder, où la règle react-hooks/refs donne un faux positif sur la capture par useMemo.
  /* eslint-disable react-hooks/refs */
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
        onPanResponderGrant: () => propsRef.current.onStartDrag(propsRef.current.index),
        onPanResponderMove: (_e, g) => propsRef.current.onMoveDrag(propsRef.current.index, g.dy),
        onPanResponderRelease: () => propsRef.current.onEndDrag(propsRef.current.index),
        onPanResponderTerminate: () => propsRef.current.onEndDrag(propsRef.current.index),
      }),
    []
  );
  /* eslint-enable react-hooks/refs */

  const {
    item,
    index,
    isActive,
    isDragging,
    offset,
    dragTranslate,
    removeLabel,
    onPlay,
    onRemove,
  } = props;
  const { title, artist, artworkUri } = item;

  return (
    <Animated.View
      style={[
        styles.rowContainer,
        { top: index * ROW_HEIGHT },
        isDragging
          ? { transform: [{ translateY: dragTranslate }], zIndex: 10, elevation: 8 }
          : { transform: [{ translateY: offset }] },
      ]}
    >
      <View style={[styles.row, (isActive || isDragging) && styles.rowRaised]}>
        <Pressable
          onPress={onPlay}
          style={styles.rowMain}
          accessibilityRole="button"
          accessibilityState={isActive ? { selected: true } : {}}
          accessibilityLabel={`Lire ${title}`}
        >
          <Cover uri={artworkUri} />
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {artist}
            </Text>
          </View>
          {isActive && <Icon name="graphic_eq" size={20} color={colors.accentIcon} />}
        </Pressable>

        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${removeLabel} ${title}`}
        >
          <Icon name="close" size={20} color={colors.textSecondary} />
        </Pressable>

        {/* Poignée de glisser : seule zone qui capte le geste de réordonnancement. */}
        <View
          style={styles.handle}
          {...responder.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel={`Réordonner ${title}`}
        >
          <Icon name="drag_indicator" size={22} color={colors.textMuted} />
        </View>
      </View>
    </Animated.View>
  );
}

/** Pochette de piste : image du tag, ou pastille pleine de repli. */
function Cover({ uri }: { uri: string | null }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.cover} contentFit="cover" accessible={false} />;
  }
  return (
    <View style={[styles.cover, styles.coverFallback]}>
      <Icon name="music_note" size={18} color={colors.onAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  rowContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  rowRaised: {
    backgroundColor: colors.surface,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 0,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: coverFallback,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...typography.heading,
    fontSize: 14,
  },
  rowTitleActive: {
    color: colors.accentIcon,
  },
  rowMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  handle: {
    paddingLeft: spacing.sm,
    paddingVertical: spacing.sm,
  },
});

export default DraggableTrackList;
