import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { colors, coverFallback, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { selection, tapLight } from '@/lib/haptics';
import { resolveIncomingOrder, type PendingOrder } from '@/lib/dragOrder';

/**
 * Liste de pistes réordonnable par glisser-déposer, sans dépendance native.
 *
 * `Animated` + `PanResponder` du cœur de React Native (pas de reanimated/gesture-handler, non
 * configurés — cf. CLAUDE.md sur les deps natives fragiles). Le geste part d'une **poignée** dédiée
 * pour ne pas entrer en conflit avec le tap (qui saute à la piste) ni avec le défilement.
 *
 * **Virtualisée** (lot 4 de l'audit) : les lignes vivent dans une `FlatList` à hauteur fixe
 * (`getItemLayout`), en flux normal — une grande playlist ne monte plus toutes ses lignes. Pendant
 * un glisser, la ligne d'origine devient invisible (sa place reste occupée) et un **clone en
 * overlay**, hors de la liste, suit le doigt : la virtualisation n'est jamais parasitée par un
 * zIndex inter-cellules. Les autres lignes s'écartent par `transform`. Près d'un bord, la liste
 * **auto-défile** (impossible avant : tout était dans un ScrollView gelé).
 *
 * Au lâcher, on réordonne localement (optimiste) puis on remonte le déplacement via `onMove`.
 *
 * Générique (file d'attente *et* détail de playlist) : les items sont normalisés en
 * `DraggableTrackItem`, chaque appelant projette son type source (RNTP `Track`, `LocalTrack`…).
 */

const ROW_HEIGHT = 64;
/** Distance au bord (px) sous laquelle l'auto-scroll s'enclenche pendant un glisser. */
const AUTO_SCROLL_EDGE = 80;
/** Pas d'auto-scroll par tick (~16 ms) : ~750 px/s. */
const AUTO_SCROLL_STEP = 12;

/** Forme minimale attendue par la liste : chaque appelant y projette son type source. */
export type DraggableTrackItem = {
  id: string;
  title: string;
  artist: string;
  /** URI de pochette, ou `null` (pastille de repli). */
  artworkUri: string | null;
  /**
   * Piste indisponible sur cet appareil (référence synchronisée sans fichier local, issue #17) :
   * ligne grisée, non jouable au tap ; retrait et réordonnancement restent possibles.
   */
  unavailable?: boolean;
};

export type DraggableTrackListProps = {
  items: DraggableTrackItem[];
  /** Id de la piste en cours (surlignage) ; robuste aux réordonnancements, contrairement à un index. */
  activeTrackId: string | undefined;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  /**
   * Appui long sur le corps d'une ligne (menu d'actions). Optionnel : ne s'affiche que si fourni,
   * et jamais sur une piste indisponible. N'entre pas en conflit avec le drag (poignée dédiée).
   */
  onLongPress?: (index: number) => void;
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

/**
 * Durée pendant laquelle un ordre optimiste (posé au lâcher) prime sur un `items` entrant qui ne
 * le reflète pas encore. La persistance (SQLite différée, `moveMediaItem` natif) confirme bien
 * avant ; passé ce délai, la source externe reprend la main (filet à identité d'objet, pas de
 * lecture d'horloge au rendu — react-hooks/purity).
 */
const PENDING_TTL_MS = 2000;

export function DraggableTrackList({
  items,
  activeTrackId,
  onPlay,
  onRemove,
  onMove,
  onLongPress,
  removeLabel = 'Retirer',
  contentPaddingBottom = 0,
}: DraggableTrackListProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Position verticale (viewport) du haut de la ligne saisie, figée au début du geste : le clone
  // s'y ancre et suit le doigt via `pan`, indépendamment du contenu qui défile dessous.
  const [grantTop, setGrantTop] = useState(0);
  const pan = useMemo(() => new Animated.Value(0), []);

  const listRef = useRef<FlatList<DraggableTrackItem>>(null);
  // Valeurs lues dans les handlers de geste et l'auto-scroll (jamais pendant le rendu).
  const scrollOffsetRef = useRef(0);
  const scrollAtGrantRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const panValueRef = useRef(0);
  const draggingIndexRef = useRef<number | null>(null);
  const dataLengthRef = useRef(items.length);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ordre affiché : source de vérité pendant un glisser (optimiste, posé au lâcher). On le
  // resynchronise sur `items` hors glisser, via le motif React « ajuster l'état pendant le
  // rendu » (pas d'effet) : ça évite de resauter si un refresh arrive en plein geste, et supprime
  // tout flash entre le lâcher optimiste et la confirmation.
  const [data, setData] = useState<DraggableTrackItem[]>(items);
  const [syncedItems, setSyncedItems] = useState<DraggableTrackItem[]>(items);
  // Ordre optimiste en attente de confirmation : tant qu'il est posé, un `items` entrant qui
  // porte les mêmes pistes dans l'ancien ordre ne peut pas écraser l'ordre du lâcher.
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);
  if (items !== syncedItems && draggingIndex === null) {
    setSyncedItems(items);
    const resolution = resolveIncomingOrder(items, pendingOrder);
    setData(resolution.data);
    if (!resolution.keepPending && pendingOrder !== null) {
      setPendingOrder(null);
    }
  }
  // Longueur courante lue par les handlers de geste : mise à jour hors rendu (règle react-hooks/refs).
  useEffect(() => {
    dataLengthRef.current = data.length;
  });

  /** Index survolé, déduit du doigt (pan) ET du défilement effectué depuis la saisie. */
  const computeHover = (index: number) => {
    const scrollDelta = scrollOffsetRef.current - scrollAtGrantRef.current;
    const dy = panValueRef.current + scrollDelta;
    return clamp(Math.round(index + dy / ROW_HEIGHT), 0, dataLengthRef.current - 1);
  };

  const stopAutoScroll = () => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  };

  /**
   * Auto-scroll de bord : tant qu'un glisser est en cours, un tick regarde où est le doigt dans le
   * viewport et fait défiler la liste par petits pas, en re-calculant l'index survolé (le contenu
   * bouge sous un doigt immobile).
   */
  const startAutoScroll = (index: number, rowViewportTop: number) => {
    stopAutoScroll();
    autoScrollTimer.current = setInterval(() => {
      const fingerY = rowViewportTop + panValueRef.current + ROW_HEIGHT / 2;
      const viewport = viewportHeightRef.current;
      if (viewport <= 0) {
        return;
      }
      let step = 0;
      if (fingerY < AUTO_SCROLL_EDGE) {
        step = -AUTO_SCROLL_STEP;
      } else if (fingerY > viewport - AUTO_SCROLL_EDGE) {
        step = AUTO_SCROLL_STEP;
      }
      if (step === 0) {
        return;
      }
      const contentHeight = dataLengthRef.current * ROW_HEIGHT;
      const maxOffset = Math.max(0, contentHeight - viewport);
      const next = clamp(scrollOffsetRef.current + step, 0, maxOffset);
      if (next === scrollOffsetRef.current) {
        return;
      }
      scrollOffsetRef.current = next;
      listRef.current?.scrollToOffset({ offset: next, animated: false });
      setHoverIndex((current) => {
        const target = computeHover(index);
        return current === target ? current : target;
      });
    }, 16);
  };

  const startDrag = (index: number) => {
    selection();
    pan.setValue(0);
    panValueRef.current = 0;
    scrollAtGrantRef.current = scrollOffsetRef.current;
    draggingIndexRef.current = index;
    const rowViewportTop = index * ROW_HEIGHT - scrollOffsetRef.current;
    setGrantTop(rowViewportTop);
    setDraggingIndex(index);
    setHoverIndex(index);
    startAutoScroll(index, rowViewportTop);
  };

  const moveDrag = (index: number, dy: number) => {
    pan.setValue(dy);
    panValueRef.current = dy;
    const next = computeHover(index);
    setHoverIndex((current) => (current === next ? current : next));
  };

  const endDrag = (index: number) => {
    stopAutoScroll();
    const to = computeHover(index);
    if (to !== index) {
      tapLight();
      // `data` est fraîche ici : les handlers de geste passent par `propsRef` (mise à jour à
      // chaque rendu) et `data` ne bouge pas pendant un glisser (la resync est suspendue).
      const next = arrayMove(data, index, to);
      const pending: PendingOrder = { ids: next.map((item) => item.id) };
      setData(next);
      setPendingOrder(pending);
      // Filet : passé le TTL sans confirmation, la source externe reprend la main. Comparaison à
      // identité d'objet — un lâcher plus récent a déjà remplacé `pending`, on ne l'efface pas.
      setTimeout(() => {
        setPendingOrder((current) => (current === pending ? null : current));
      }, PENDING_TTL_MS);
      onMove(index, to);
    }
    pan.setValue(0);
    panValueRef.current = 0;
    draggingIndexRef.current = null;
    setDraggingIndex(null);
    setHoverIndex(null);
  };

  // Sécurité : pas de timer orphelin si la liste est démontée en plein geste.
  useEffect(() => stopAutoScroll, []);

  const draggedItem = draggingIndex !== null ? data[draggingIndex] : null;

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        viewportHeightRef.current = e.nativeEvent.layout.height;
      }}
    >
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item) => item.id}
        getItemLayout={(_d, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        scrollEnabled={draggingIndex === null}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        windowSize={7}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: contentPaddingBottom }}
        renderItem={({ item, index }) => (
          <DraggableRow
            item={item}
            index={index}
            isActive={item.id === activeTrackId}
            isDragging={index === draggingIndex}
            offset={rowOffset(index, draggingIndex, hoverIndex)}
            removeLabel={removeLabel}
            onStartDrag={startDrag}
            onMoveDrag={moveDrag}
            onEndDrag={endDrag}
            onPlay={() => onPlay(index)}
            onRemove={() => onRemove(index)}
            onLongPress={onLongPress ? () => onLongPress(index) : undefined}
          />
        )}
      />

      {/* Clone de la ligne saisie : hors de la FlatList (overlay), il suit le doigt sans jamais
          perturber la virtualisation. La ligne d'origine garde sa place, invisible. */}
      {draggedItem && (
        <Animated.View
          pointerEvents="none"
          style={[styles.dragOverlay, { top: grantTop, transform: [{ translateY: pan }] }]}
        >
          <RowContent item={draggedItem} isActive={draggedItem.id === activeTrackId} />
        </Animated.View>
      )}
    </View>
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
  removeLabel: string;
  onStartDrag: (index: number) => void;
  onMoveDrag: (index: number, dy: number) => void;
  onEndDrag: (index: number) => void;
  onPlay: () => void;
  onRemove: () => void;
  onLongPress?: () => void;
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

  const { item, isActive, isDragging, offset, removeLabel, onPlay, onRemove, onLongPress } = props;
  const { title, artist, artworkUri } = item;
  const unavailable = item.unavailable ?? false;

  return (
    <View
      style={[
        styles.rowContainer,
        // La ligne saisie reste montée (sa place est tenue) mais invisible : le clone en overlay
        // la remplace visuellement. Les autres s'écartent pour ouvrir l'emplacement visé.
        isDragging ? styles.rowHidden : { transform: [{ translateY: offset }] },
      ]}
    >
      <View style={[styles.row, isActive && styles.rowRaised]}>
        <Pressable
          onPress={unavailable ? undefined : onPlay}
          onLongPress={unavailable ? undefined : onLongPress}
          delayLongPress={300}
          disabled={unavailable}
          style={[styles.rowMain, unavailable && styles.rowMainUnavailable]}
          accessibilityRole="button"
          accessibilityState={{ selected: isActive, disabled: unavailable }}
          accessibilityLabel={
            unavailable ? `${title}, indisponible sur cet appareil` : `Lire ${title}`
          }
          accessibilityHint={
            onLongPress && !unavailable ? 'Appui long pour plus d’actions' : undefined
          }
        >
          <Cover uri={artworkUri} />
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {unavailable ? `${artist} · indisponible` : artist}
            </Text>
          </View>
          {isActive && !unavailable && (
            <Icon name="graphic_eq" size={20} color={colors.accentIcon} />
          )}
          {unavailable && <Icon name="cloud_off" size={18} color={colors.textMuted} />}
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
    </View>
  );
}

/**
 * Clone visuel de la ligne saisie, rendu en overlay pendant un glisser : pochette + titres +
 * indicateurs, sans aucune zone interactive (le clone est `pointerEvents="none"`).
 */
function RowContent({ item, isActive }: { item: DraggableTrackItem; isActive: boolean }) {
  const { title, artist, artworkUri } = item;
  const unavailable = item.unavailable ?? false;

  return (
    <View style={[styles.row, styles.rowRaised]}>
      <View style={[styles.rowMain, unavailable && styles.rowMainUnavailable]}>
        <Cover uri={artworkUri} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {unavailable ? `${artist} · indisponible` : artist}
          </Text>
        </View>
        {isActive && !unavailable && <Icon name="graphic_eq" size={20} color={colors.accentIcon} />}
        {unavailable && <Icon name="cloud_off" size={18} color={colors.textMuted} />}
      </View>
      <View style={styles.handle}>
        <Icon name="drag_indicator" size={22} color={colors.textMuted} />
      </View>
    </View>
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
  container: {
    flex: 1,
  },
  rowContainer: {
    height: ROW_HEIGHT,
  },
  rowHidden: {
    opacity: 0,
  },
  dragOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW_HEIGHT,
    zIndex: 10,
    elevation: 8,
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
  rowMainUnavailable: {
    opacity: 0.45,
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
