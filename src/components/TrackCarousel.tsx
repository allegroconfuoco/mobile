import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { MediaItem } from '@rntp/player';

import { tapLight } from '@/lib/haptics';
import { SPRING_SNAPPY } from '@/lib/motion';
import { usePlaybackMode, usePlayer, useQueue } from '@/player/PlayerProvider';
import { neighborIndex } from '@/player/usePlayback';

/**
 * Carrousel de pistes : la piste en cours et ses deux voisines, posées côte à côte comme des
 * pages. Glisser fait défiler les pages **sous le doigt** ; au relâchement la page voisine vient
 * prendre toute la place et la lecture saute à cette piste. Partagé par le mini-lecteur (pochette
 * + titre) et l'écran Lecture (grande pochette).
 *
 * **Pourquoi des positions « virtuelles ».** Chaque page porte un numéro d'ordre fixe — la piste
 * en cours est à `v`, la suivante à `v + 1`. Quand on passe à la suivante, on ne remet rien à
 * zéro : c'est `v` qui avance d'un cran, et la page `v + 1`, déjà à l'écran en fin de geste,
 * devient simplement la page courante. Aucun contenu ne change de place au moment où la lecture
 * bascule, donc pas de saut d'image entre la fin du geste et la mise à jour de l'interface.
 *
 * Le même mécanisme anime les changements de piste venus d'ailleurs (fin de morceau, bouton
 * suivant, notification) : `v` bouge, les pages glissent.
 *
 * Tout le suivi du doigt et l'animation de pose tournent sur le thread d'interface ; le JS n'est
 * sollicité qu'une fois, pour demander le changement de piste.
 */

/** Fraction de la largeur à dépasser pour valider un changement de piste. */
const COMMIT_RATIO = 0.28;
/** Vitesse horizontale (px/s) qui valide même un geste court. */
const COMMIT_VELOCITY = 650;
/** Résistance quand il n'y a pas de piste dans la direction du geste. */
const EDGE_RESISTANCE = 0.22;
/** Délai au-delà duquel un changement demandé mais non obtenu fait revenir la page. */
const REVERT_AFTER_MS = 900;

export type CarouselPage = {
  /** Position virtuelle de la page (clé React stable d'un changement de piste à l'autre). */
  slot: number;
  item: MediaItem;
  /** Vrai pour la page de la piste en cours. */
  current: boolean;
};

export type TrackCarousel = {
  pages: CarouselPage[];
  /** Geste horizontal, à composer avec les autres gestes de l'écran. */
  gesture: PanGesture;
  /** À poser sur le conteneur qui borne les pages (il fixe la largeur d'une page). */
  onLayout: (e: LayoutChangeEvent) => void;
  /** Valeurs partagées à passer à chaque `CarouselPageView`. */
  position: SharedValue<number>;
  drag: SharedValue<number>;
  width: SharedValue<number>;
};

type Tracking = {
  /** Position virtuelle de la piste en cours. */
  slot: number;
  id: string | undefined;
  prevId: string | undefined;
  nextId: string | undefined;
  /** Sens du dernier geste validé, en attente du changement de piste correspondant. */
  hint: 1 | -1 | null;
  /** Vrai quand la position doit être posée sans glisser (première piste, file vidée). */
  instant: boolean;
};

export function useTrackCarousel(): TrackCarousel {
  const queue = useQueue();
  const { repeatMode } = usePlaybackMode();
  const { skipToIndex } = usePlayer();

  const { tracks, activeIndex } = queue;
  const prevIndex = neighborIndex(queue, repeatMode, -1);
  const nextIndex = neighborIndex(queue, repeatMode, 1);
  const current = activeIndex != null ? tracks[activeIndex] : undefined;
  const prev = prevIndex != null ? tracks[prevIndex] : undefined;
  const next = nextIndex != null ? tracks[nextIndex] : undefined;

  // Suivi de la piste en cours et de ses voisines, ajusté pendant le rendu : quand la piste
  // change, on déduit dans quel sens déplacer `slot` en regardant si la nouvelle piste était la
  // voisine de droite ou de gauche. Un saut sans rapport (nouvelle file) avance d'un cran.
  const [tracking, setTracking] = useState<Tracking>({
    slot: 0,
    id: current?.mediaId,
    prevId: prev?.mediaId,
    nextId: next?.mediaId,
    hint: null,
    instant: true,
  });
  if (current?.mediaId !== tracking.id) {
    // Apparition de la première piste (ou file vidée) : il n'y a rien d'où glisser.
    const appearing = tracking.id === undefined || current?.mediaId === undefined;
    const wasPrev = current?.mediaId !== undefined && current.mediaId === tracking.prevId;
    const wasNext = current?.mediaId !== undefined && current.mediaId === tracking.nextId;
    // File de deux titres en boucle : la même piste est des deux côtés, seul le geste tranche.
    const delta = wasPrev && wasNext ? (tracking.hint ?? 1) : wasPrev ? -1 : 1;
    setTracking({
      slot: tracking.slot + delta,
      id: current?.mediaId,
      prevId: prev?.mediaId,
      nextId: next?.mediaId,
      hint: null,
      instant: appearing,
    });
  } else if (prev?.mediaId !== tracking.prevId || next?.mediaId !== tracking.nextId) {
    setTracking({ ...tracking, prevId: prev?.mediaId, nextId: next?.mediaId });
  }

  const slot = tracking.slot;
  const instant = tracking.instant;
  const position = useSharedValue(slot);
  const drag = useSharedValue(0);
  const width = useSharedValue(0);
  // Miroirs côté interface de l'état React, lus par le geste.
  const slotValue = useSharedValue(slot);
  const settlingTo = useSharedValue(slot);
  const hasPrev = useSharedValue(prev !== undefined);
  const hasNext = useSharedValue(next !== undefined);

  useEffect(() => {
    hasPrev.set(prev !== undefined);
    hasNext.set(next !== undefined);
  }, [prev, next, hasPrev, hasNext]);

  // La piste a changé : les pages glissent vers la nouvelle position. Si c'est le geste qui a
  // provoqué le changement, l'animation de pose vise déjà cette position — on ne la relance pas,
  // ce qui casserait son élan.
  useEffect(() => {
    slotValue.set(slot);
    if (instant) {
      settlingTo.set(slot);
      position.set(slot);
      return;
    }
    if (settlingTo.get() !== slot) {
      settlingTo.set(slot);
      position.set(withSpring(slot, SPRING_SNAPPY));
    }
  }, [slot, instant, slotValue, settlingTo, position]);

  /** Demande le changement de piste (appelé depuis le thread d'interface, en fin de geste). */
  const commit = (direction: 1 | -1) => {
    const target = direction === 1 ? nextIndex : prevIndex;
    tapLight();
    if (target != null) {
      setTracking((t) => ({ ...t, hint: direction }));
      skipToIndex(target);
    }
    // Filet : si la piste n'a pas changé (fichier illisible, file modifiée entre-temps), la page
    // revient à sa place au lieu de rester décalée.
    setTimeout(() => {
      const settled = slotValue.get();
      if (settlingTo.get() !== settled) {
        settlingTo.set(settled);
        position.set(withSpring(settled, SPRING_SNAPPY));
      }
    }, REVERT_AFTER_MS);
  };

  const gesture = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onChange((e) => {
      const blocked = e.translationX < 0 ? !hasNext.get() : !hasPrev.get();
      drag.set(blocked ? e.translationX * EDGE_RESISTANCE : e.translationX);
    })
    .onEnd((e) => {
      const w = width.get() || 1;
      const base = slotValue.get();
      const goNext =
        hasNext.get() && (e.translationX < -w * COMMIT_RATIO || e.velocityX < -COMMIT_VELOCITY);
      const goPrev =
        hasPrev.get() && (e.translationX > w * COMMIT_RATIO || e.velocityX > COMMIT_VELOCITY);
      // Le déplacement du doigt est reversé dans la position : même image à l'écran, mais une
      // seule valeur à animer pour la pose.
      position.set(base - drag.get() / w);
      drag.set(0);
      const direction = goNext ? 1 : goPrev ? -1 : 0;
      const target = base + direction;
      settlingTo.set(target);
      position.set(withSpring(target, { ...SPRING_SNAPPY, velocity: -e.velocityX / w }));
      if (direction !== 0) {
        scheduleOnRN(commit, direction);
      }
    })
    .onFinalize((_e, success) => {
      // Geste interrompu (un autre geste a pris la main) : rien n'est validé, on se recale.
      if (!success && drag.get() !== 0) {
        const w = width.get() || 1;
        position.set(slotValue.get() - drag.get() / w);
        drag.set(0);
        position.set(withSpring(slotValue.get(), SPRING_SNAPPY));
      }
    });

  const onLayout = (e: LayoutChangeEvent) => width.set(e.nativeEvent.layout.width);

  const pages: CarouselPage[] = [];
  if (current) {
    if (prev) {
      pages.push({ slot: slot - 1, item: prev, current: false });
    }
    pages.push({ slot, item: current, current: true });
    if (next) {
      pages.push({ slot: slot + 1, item: next, current: false });
    }
  }

  return { pages, gesture, onLayout, position, drag, width };
}

/**
 * Une page du carrousel : occupe tout le conteneur et se translate selon sa position virtuelle.
 * Le conteneur parent doit avoir `overflow: 'hidden'`.
 */
export function CarouselPageView({
  slot,
  carousel,
  style,
  children,
}: {
  slot: number;
  carousel: Pick<TrackCarousel, 'position' | 'drag' | 'width'>;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { position, drag, width } = carousel;
  const animatedStyle = useAnimatedStyle(() => {
    const w = width.get();
    return {
      // Tant que la largeur n'est pas mesurée, toutes les pages seraient superposées : seule la
      // page courante est visible.
      opacity: w === 0 && slot !== Math.round(position.get()) ? 0 : 1,
      transform: [{ translateX: (slot - position.get()) * w + drag.get() }],
    };
  });
  return <Animated.View style={[styles.page, style, animatedStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  page: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
