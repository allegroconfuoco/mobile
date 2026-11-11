import { memo } from 'react';

import { SwipeableRow } from '@/components/SwipeableRow';
import { TrackIndexRow } from '@/components/TrackRow';
import type { LocalTrack } from '@/library/useAudioLibrary';

/**
 * Ligne complète d'une liste de pistes : la ligne elle-même, son bouton « + », son glissement
 * « Lire ensuite » et sa case de sélection. C'est l'élément rendu par toutes les listes plates
 * (Morceaux, artiste, album, favoris, récents, recherche).
 *
 * Mémoïsée sur des props primitives et des handlers stables (cf. `useTrackListActions`) : cocher
 * une ligne ou changer de piste ne re-rend que les lignes réellement concernées, pas la fenêtre
 * entière de la liste.
 */
export type TrackListItemProps = {
  track: LocalTrack;
  /** Index de lecture dans la liste affichée. */
  index: number;
  isActive: boolean;
  onPlay: (index: number) => void;
  /** Appui long : entre en sélection multiple. */
  onLongPress: (track: LocalTrack) => void;
  onAdd: (track: LocalTrack) => void;
  onPlayNext: (track: LocalTrack) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (track: LocalTrack) => void;
  leadingNumber?: number | null;
  subtitle?: string;
};

export const TrackListItem = memo(function TrackListItem({
  track,
  index,
  isActive,
  onPlay,
  onLongPress,
  onAdd,
  onPlayNext,
  selectionMode,
  selected,
  onToggleSelect,
  leadingNumber,
  subtitle,
}: TrackListItemProps) {
  return (
    // Le glissement est neutralisé en mode sélection : cocher des lignes et les faire glisser sont
    // deux intentions incompatibles.
    <SwipeableRow
      onSwipe={() => onPlayNext(track)}
      label="Lire ensuite"
      icon="playlist_play"
      enabled={!selectionMode}
    >
      <TrackIndexRow
        track={track}
        index={index}
        isActive={isActive}
        onPlay={onPlay}
        onLongPress={onLongPress}
        selectionMode={selectionMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
        onAdd={onAdd}
        leadingNumber={leadingNumber}
        subtitle={subtitle}
      />
    </SwipeableRow>
  );
});

export default TrackListItem;
