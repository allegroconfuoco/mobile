import { useMemo } from 'react';

import { TrackListScreen } from '@/components/TrackListScreen';
import { useLibrary } from '@/library/LibraryProvider';

import { countLabel } from '@/tabs/shared';
import { recentTracks } from '@/tabs/PlaylistsTab';

/** Récemment ajoutés : les derniers fichiers arrivés sur le téléphone, du plus récent au plus ancien. */
export default function RecentScreen() {
  const { tracks } = useLibrary();
  const recent = useMemo(() => recentTracks(tracks), [tracks]);
  const sections = useMemo(() => [{ key: 'recent', data: recent }], [recent]);

  return (
    <TrackListScreen
      kind="Playlist automatique"
      title="Récemment ajoutés"
      meta={countLabel(recent.length, 'titre')}
      cover={{ uri: null, icon: 'history', seed: 'recents' }}
      context="recent"
      source={{ kind: 'recent' }}
      sections={sections}
      emptyText="Aucun titre sur l’appareil."
    />
  );
}
