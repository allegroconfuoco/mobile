import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/lib/useRouter';

import { colors, radii, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import { TrackIndexRow } from '@/components/TrackRow';
import { QuickActionsSheet, type QuickAction } from '@/components/QuickActionsSheet';
import { useTrackActionsMenu } from '@/components/useTrackActionsMenu';
import {
  groupAlbumRowsByDisc,
  makeAlbumKey,
  mergeAlbumWithTracklist,
  tracksForAlbum,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
} from '@/library/grouping';
import * as db from '@/library/db';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/**
 * Détail d'un album (issue #13) : ses pistes dans l'ordre (disque, puis n° de piste, puis titre).
 *
 * Reçoit `artist` (album artist) et `title` en params de route, reconstruit la clé d'album et
 * filtre la bibliothèque partagée — pas de duplication de la métadonnée, tout dérive de la même
 * source que l'onglet Albums. Les albums multi-disques sont sectionnés par disque (TPOS) ; un
 * album mono-disque n'affiche aucun en-tête de disque.
 */
export default function AlbumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ artist?: string; title?: string }>();
  const artist = params.artist ?? UNKNOWN_ARTIST;
  const title = params.title ?? UNKNOWN_ALBUM;

  const { tracks } = useLibrary();
  const { playQueue } = usePlayer();
  const { track: activeTrack } = usePlayback();
  const trackMenu = useTrackActionsMenu();

  // Pistes locales, sections (locaux + fantômes) et index de lecture, dérivés ensemble. Si l'album
  // a été identifié (#23), on charge la tracklist complète de la release et on intercale les titres
  // manquants en « fantôme » ; sinon, seules les pistes locales sont affichées (aucun fantôme).
  const { albumTracks, sections, indexById, ghostCount, identified } = useMemo(() => {
    const ordered = tracksForAlbum(tracks, makeAlbumKey(artist, title));
    const releaseMbid = db.getAlbumReleaseMbid(ordered.map((t) => t.id));
    const tracklist = releaseMbid ? db.loadReleaseTracklist(releaseMbid) : [];
    const rows = mergeAlbumWithTracklist(ordered, tracklist);
    // File de lecture = pistes locales uniquement (les fantômes ne sont jamais jouables), dans
    // l'ordre d'affichage ; l'index de lecture est clé par id local, indépendant des fantômes.
    const locals = rows.flatMap((r) => (r.kind === 'local' ? [r.track] : []));
    const map = new Map<string, number>();
    locals.forEach((t, i) => map.set(t.id, i));
    return {
      albumTracks: locals,
      sections: groupAlbumRowsByDisc(rows),
      indexById: map,
      ghostCount: rows.length - locals.length,
      identified: releaseMbid != null,
    };
  }, [tracks, artist, title]);

  // Première pochette disponible : tag local, sinon pochette d'enrichissement (issue #19).
  const cover = albumTracks.map((t) => t.artworkUri ?? t.coverArtUrl).find(Boolean) ?? null;
  const multiDisc = sections.length > 1;
  // Ordre incertain si au moins une piste n'a pas de n° (tag TRCK manquant → tri alphabétique).
  const orderUncertain = albumTracks.some((t) => t.trackNo == null);
  // Incomplétude probable : numérotation à trous (n° max > nb de pistes). Heuristique qui, sur un
  // album partiel **non encore identifié**, incite à l'identifier — c'est l'identification qui
  // révèle ensuite les titres manquants en fantôme.
  const maxTrackNo = albumTracks.reduce((m, t) => Math.max(m, t.trackNo ?? 0), 0);
  const hasGaps = maxTrackNo > albumTracks.length;
  // Bac « Album inconnu » d'un artiste connu : les titres viennent de plusieurs albums, un match
  // release unique (identify) n'a pas de sens — on propose le multi-match qui range chaque titre.
  const isUnknownBucket = title === UNKNOWN_ALBUM && artist !== UNKNOWN_ARTIST;

  // Handler stable pour les lignes mémoïsées (cf. TrackIndexRow).
  const playFrom = useCallback(
    (index: number) => void playQueue(albumTracks, index, 'album'),
    [playQueue, albumTracks]
  );

  const identify = () => router.push({ pathname: '/identify-album', params: { artist, title } });
  const sortUnknown = () => router.push({ pathname: '/sort-unknown-album', params: { artist } });
  const editArtists = () =>
    router.push({
      pathname: '/edit-artists',
      params: { scope: 'album', albumArtist: artist, album: title, label: title },
    });
  const writeToFiles = () =>
    router.push({
      pathname: '/write-tags',
      params: { scope: 'album', albumArtist: artist, album: title, label: title },
    });
  const cleanupTitles = () =>
    router.push({
      pathname: '/title-cleanup',
      params: { albumArtist: artist, album: title, label: title },
    });

  // Actions d'en-tête regroupées derrière un unique « … » (lot 11) au lieu d'une rangée d'icônes.
  const [actionsOpen, setActionsOpen] = useState(false);
  const headerActions: QuickAction[] = [
    ...(isUnknownBucket
      ? [
          {
            icon: 'auto_fix_high',
            label: 'Ranger les titres via MusicBrainz',
            onPress: sortUnknown,
          } as QuickAction,
        ]
      : [
          { icon: 'travel_explore', label: 'Identifier l’album', onPress: identify } as QuickAction,
        ]),
    { icon: 'group', label: 'Modifier les artistes', onPress: editArtists },
    { icon: 'save', label: 'Écrire les tags dans les fichiers', onPress: writeToFiles },
    { icon: 'delete_sweep', label: 'Nettoyer les titres', onPress: cleanupTitles },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} />
        <View style={styles.topActions}>
          <Pressable
            onPress={() => setActionsOpen(true)}
            hitSlop={12}
            style={styles.identifyButton}
            accessibilityRole="button"
            accessibilityLabel="Actions sur l’album"
          >
            <Icon name="more_horiz" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) =>
          item.kind === 'local' ? item.track.id : `ghost-${item.disc}-${item.position}`
        }
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <TrackCover uri={cover} size={132} fallbackIcon="album" />
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {artist}
            </Text>
            <Text style={styles.count}>
              {albumTracks.length} {albumTracks.length > 1 ? 'titres' : 'titre'}
              {ghostCount > 0 ? ` · ${ghostCount} manquant${ghostCount > 1 ? 's' : ''}` : ''}
            </Text>
            {isUnknownBucket ? (
              <Pressable
                onPress={sortUnknown}
                style={styles.badge}
                accessibilityRole="button"
                accessibilityLabel="Ranger les titres dans leurs albums via MusicBrainz"
              >
                <Icon name="auto_fix_high" size={14} color={colors.accentLabel} />
                <Text style={styles.badgeText}>Ranger les titres via MusicBrainz</Text>
              </Pressable>
            ) : (
              !identified &&
              (orderUncertain || hasGaps) && (
                <Pressable
                  onPress={identify}
                  style={styles.badge}
                  accessibilityRole="button"
                  accessibilityLabel="Identifier l’album pour voir les titres manquants"
                >
                  <Icon name="travel_explore" size={14} color={colors.accentLabel} />
                  <Text style={styles.badgeText}>Identifier · voir les titres manquants</Text>
                </Pressable>
              )
            )}
          </View>
        }
        renderSectionHeader={({ section }) =>
          multiDisc ? <Text style={styles.discHeader}>Disque {section.disc ?? '?'}</Text> : null
        }
        renderItem={({ item }) =>
          item.kind === 'local' ? (
            <TrackIndexRow
              track={item.track}
              index={indexById.get(item.track.id) ?? 0}
              isActive={item.track.id === activeTrack?.id}
              leadingNumber={item.track.trackNo ?? (indexById.get(item.track.id) ?? 0) + 1}
              subtitle={item.track.artist ?? UNKNOWN_ARTIST}
              onPlay={playFrom}
              onLongPress={trackMenu.open}
            />
          ) : (
            <GhostRow position={item.position} title={item.title} />
          )
        }
        windowSize={7}
        ListEmptyComponent={<Text style={styles.empty}>Album introuvable.</Text>}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      {trackMenu.element}

      <QuickActionsSheet
        visible={actionsOpen}
        title={title}
        actions={headerActions}
        onClose={() => setActionsOpen(false)}
      />
    </View>
  );
}

/**
 * Ligne d'un titre manquant (« fantôme ») : piste connue par la release identifiée mais absente
 * localement. Purement visuelle et non interactive — on ne peut pas la jouer, elle sert à voir ce
 * qu'il reste à récupérer pour compléter l'album. Aucune action d'acquisition (hors périmètre).
 */
function GhostRow({ position, title }: { position: number; title: string }) {
  return (
    <View
      style={styles.ghostRow}
      accessibilityRole="text"
      accessibilityLabel={`${title || 'Titre inconnu'}, titre manquant`}
    >
      <View style={styles.ghostNumberBox}>
        <Text style={styles.ghostNumber}>{position}</Text>
      </View>
      <View style={styles.ghostText}>
        <Text style={styles.ghostTitle} numberOfLines={1}>
          {title || 'Titre inconnu'}
        </Text>
        <Text style={styles.ghostMeta} numberOfLines={1}>
          Manquant
        </Text>
      </View>
      <Icon name="music_off" size={18} color={colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    opacity: 0.55,
  },
  ghostNumberBox: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostNumber: {
    ...typography.body,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  ghostText: {
    flex: 1,
  },
  ghostTitle: {
    ...typography.heading,
    color: colors.textSecondary,
  },
  ghostMeta: {
    ...typography.label,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  identifyButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  badgeText: {
    ...typography.label,
    fontSize: 10,
    color: colors.accentLabel,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  artist: {
    ...typography.body,
    color: colors.textSecondary,
  },
  count: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  discHeader: {
    ...typography.label,
    color: colors.accentLabel,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  empty: {
    ...typography.body,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
});
