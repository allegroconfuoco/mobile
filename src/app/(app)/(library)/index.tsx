import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useRouter } from '@/lib/useRouter';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { MenuButton } from '@/components/MenuButton';
import { OfflineBanner } from '@/components/OfflineBanner';
import { computeResume, type Resume } from '@/components/ResumeCard';
import { TrackCover } from '@/components/TrackCover';
import { showToast } from '@/components/Toast';
import * as db from '@/library/db';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import { useFavorites } from '@/library/FavoritesProvider';
import { usePlayer } from '@/player/PlayerProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { formatDuration } from '@/history/format';

/**
 * Écran d'accueil (Dashboard).
 *
 * Le cœur de l'écran est une **grille de six accès rapides**, calculée automatiquement : reprise
 * de l'écoute, favoris, « En boucle », puis les playlists les plus récemment touchées. Rien n'est
 * à configurer, et chaque tuile offre les deux intentions en **un seul geste** — le corps de la
 * tuile ouvre la destination, le bouton de lecture la joue tout de suite.
 *
 * Rien n'est stocké ici : tout est dérivé de l'état local (bibliothèque, playlists, favoris, point
 * de reprise) et des agrégats SQL d'écoute, recalculés au focus seulement si l'historique a bougé.
 */

/** Taille des playlists virtuelles (mêmes bornes que l'écran Écoutes). */
const VIRTUAL_SIZE = 25;
const RECENT_LIMIT = 12;
/** Grille 2 × 3 : au-delà, l'accueil redevient une liste à faire défiler. */
const QUICK_ACCESS_SLOTS = 6;

type DashboardData = {
  totals: db.PlayTotals;
  loop: db.TopTrackRow[];
  year: db.TopTrackRow[];
};

function loadDashboardData(): DashboardData {
  return {
    totals: db.playTotals(null),
    loop: db.topTracks(Date.now() - 30 * 86_400_000, VIRTUAL_SIZE),
    year: db.topTracks(new Date(new Date().getFullYear(), 0, 1).getTime(), VIRTUAL_SIZE),
  };
}

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 6) {
    return 'Bonne nuit';
  }
  if (h < 18) {
    return 'Bonjour';
  }
  return 'Bonsoir';
}

/** Une tuile de la grille d'accès rapides. */
type QuickTile = {
  key: string;
  label: string;
  /** Pochette de la tuile ; à défaut, l'icône ci-dessous sur fond neutre. */
  artworkUri?: string | null;
  /** Graine du dégradé de repli (garde une couleur stable par tuile). */
  seed?: string;
  icon: IconName;
  iconColor?: string;
  /** Tap sur le corps de la tuile. */
  onOpen: () => void;
  /** Bouton de lecture ; absent = tuile purement navigable. */
  onPlay?: () => void;
};

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracks, tracksById } = useLibrary();
  const { playlists, getEntries, revision } = usePlaylistsContext();
  const { favoriteIds } = useFavorites();
  const { playQueue, seekTo } = usePlayer();

  // Agrégats d'écoute : calculés une fois, recalculés au focus seulement si `play_events` a bougé
  // (même compteur de version que l'écran Écoutes) — un retour sur l'accueil sans nouvelle écoute
  // ne refait aucun travail SQL.
  const [data, setData] = useState<DashboardData>(() => loadDashboardData());
  const [computedAt, setComputedAt] = useState(() => db.getPlayEventsVersion());
  // Le point de reprise est écrit par les événements du lecteur, hors rendu : il ne peut pas se
  // dériver de l'état React, on le relit à chaque focus.
  const [resume, setResume] = useState<Resume | null>(null);
  useFocusEffect(
    useCallback(() => {
      setResume(computeResume(tracksById));
      if (db.getPlayEventsVersion() === computedAt) {
        return;
      }
      setComputedAt(db.getPlayEventsVersion());
      setData(loadDashboardData());
    }, [computedAt, tracksById])
  );

  // Derniers titres entrés dans la bibliothèque (indépendant des écoutes).
  const recent = useMemo(
    () => [...tracks].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, RECENT_LIMIT),
    [tracks]
  );

  // Résout une playlist virtuelle (tops → fichiers locaux, absents omis) puis joue.
  const playVirtual = useCallback(
    (rows: db.TopTrackRow[]) => {
      const resolved = rows
        .map((row) => (row.localTrackId ? tracksById.get(row.localTrackId) : undefined))
        .filter((t): t is LocalTrack => t !== undefined);
      if (resolved.length === 0) {
        showToast('Aucun de ces titres n’est disponible ici', 'music_off');
        return;
      }
      void playQueue(resolved, 0, 'library');
    },
    [tracksById, playQueue]
  );

  const favoriteTracks = useMemo(() => {
    const list: LocalTrack[] = [];
    for (const id of favoriteIds) {
      const track = tracksById.get(id);
      if (track) {
        list.push(track);
      }
    }
    return list;
  }, [favoriteIds, tracksById]);

  const tiles = useMemo(() => {
    const list: QuickTile[] = [];

    if (resume) {
      const track = resume.tracks[resume.index];
      list.push({
        key: 'resume',
        label: 'Reprendre',
        artworkUri: track.artworkUri ?? track.coverArtUrl,
        seed: `${track.title}${track.artist ?? ''}`,
        icon: 'play_arrow',
        onOpen: () => router.push('/now-playing'),
        onPlay: () => {
          const positionMs = resume.positionMs;
          void playQueue(resume.tracks, resume.index, 'resume').then(() => {
            if (positionMs > 0) {
              seekTo(positionMs / 1000);
            }
          });
        },
      });
    }

    list.push({
      key: 'favorites',
      label: 'Favoris',
      icon: 'favorite',
      iconColor: colors.accent,
      onOpen: () => router.push('/favorites'),
      onPlay:
        favoriteTracks.length > 0
          ? () => void playQueue(favoriteTracks, 0, 'favorites')
          : undefined,
    });

    if (data.loop.length > 0) {
      list.push({
        key: 'loop',
        label: 'En boucle',
        icon: 'repeat',
        iconColor: colors.accentIcon,
        onOpen: () => router.push('/stats'),
        onPlay: () => playVirtual(data.loop),
      });
    }

    if (data.year.length > 0) {
      list.push({
        key: 'year',
        label: `Top ${new Date().getFullYear()}`,
        icon: 'library_music',
        iconColor: colors.accentIcon,
        onOpen: () => router.push('/stats'),
        onPlay: () => playVirtual(data.year),
      });
    }

    // Playlists les plus récemment touchées (`loadPlaylists` trie déjà par `updated_at DESC`).
    for (const playlist of playlists) {
      if (list.length >= QUICK_ACCESS_SLOTS) {
        break;
      }
      list.push({
        key: `playlist:${playlist.id}`,
        label: playlist.name,
        icon: 'queue_music',
        onOpen: () => router.push({ pathname: '/playlist', params: { id: playlist.id } }),
        onPlay: () => {
          // Résolution au tap seulement : charger les entrées des playlists au rendu de l'accueil
          // ferait une requête par tuile à chaque passage.
          const resolved = getEntries(playlist.id)
            .map((entry) => (entry.localTrackId ? tracksById.get(entry.localTrackId) : undefined))
            .filter((t): t is LocalTrack => t !== undefined);
          if (resolved.length === 0) {
            showToast('Aucun titre disponible ici', 'music_off');
            return;
          }
          void playQueue(resolved, 0, `playlist:${playlist.id}`);
        },
      });
    }

    return list.slice(0, QUICK_ACCESS_SLOTS);
    // `revision` : les entrées de playlist changent sans que `playlists` ne change d'identité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resume,
    favoriteTracks,
    data.loop,
    data.year,
    playlists,
    revision,
    router,
    playQueue,
    seekTo,
    playVirtual,
    getEntries,
    tracksById,
  ]);

  const { totals } = data;
  const hasPlays = totals.plays > 0;
  const hasLibrary = tracks.length > 0;
  const greeting = greetingFor(new Date());

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <MenuButton />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{greeting}</Text>
            <Text style={styles.subtitle}>Fuoco · ta musique</Text>
          </View>
          {/* Recherche et réglages en un tap : deux destinations quotidiennes qui passaient
              autrement par l'ouverture du menu latéral. */}
          <Pressable
            onPress={() =>
              router.push({ pathname: '/library', params: { view: 'tracks', q: '1' } })
            }
            hitSlop={10}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Rechercher"
          >
            <Icon name="search" size={24} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={10}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Réglages"
          >
            <Icon name="settings" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Réseau absent : l'app fonctionne, seule la synchro est en attente. */}
        <OfflineBanner />

        {tiles.length > 0 && (
          <View style={styles.grid}>
            {tiles.map((tile) => (
              <QuickAccessTile key={tile.key} tile={tile} />
            ))}
          </View>
        )}

        {/* Résumé des écoutes (tout l'historique) — raccourci vers l'écran Écoutes. */}
        {hasPlays && (
          <Pressable
            onPress={() => router.push('/stats')}
            style={({ pressed }) => [styles.statsCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Voir mes écoutes"
          >
            <View style={styles.tiles}>
              <StatTile label="Temps d'écoute" value={formatDuration(totals.playedMs)} wide />
              <StatTile label="Écoutes" value={String(totals.plays)} />
              <StatTile label="Titres" value={String(totals.uniqueTracks)} />
            </View>
            <View style={styles.statsLink}>
              <Text style={styles.statsLinkText}>Voir mes écoutes</Text>
              <Icon name="chevron_right" size={20} color={colors.accentIcon} />
            </View>
          </Pressable>
        )}

        {/* Derniers titres ajoutés à la bibliothèque. */}
        {recent.length > 0 && (
          <>
            <SectionHeader
              label="Récemment ajoutés"
              actionLabel="Bibliothèque"
              onAction={() => router.push({ pathname: '/library', params: { view: 'tracks' } })}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recentRow}
            >
              {recent.map((track, index) => (
                <Pressable
                  key={track.id}
                  // La file reprend toute la rangée : on peut continuer d'écouter les ajouts.
                  onPress={() => void playQueue(recent, index, 'library')}
                  style={styles.recentTile}
                  accessibilityRole="button"
                  accessibilityLabel={`Lire ${track.title}`}
                >
                  <TrackCover
                    uri={track.artworkUri ?? track.coverArtUrl}
                    size={116}
                    fallbackIcon="music_note"
                    seed={`${track.title}${track.artist ?? ''}`}
                  />
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {track.title}
                  </Text>
                  <Text style={styles.recentArtist} numberOfLines={1}>
                    {track.artist ?? 'Artiste inconnu'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* Bibliothèque vide : oriente vers l'écran Morceaux (menu latéral aussi). */}
        {!hasLibrary && (
          <View style={styles.emptyLibrary}>
            <Icon name="library_music" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              Ta bibliothèque est vide pour l’instant. Ouvre « Morceaux » depuis le menu pour
              scanner ta musique.
            </Text>
            <Pressable
              onPress={() => router.push({ pathname: '/library', params: { view: 'tracks' } })}
              style={styles.emptyButton}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir la bibliothèque"
            >
              <Text style={styles.emptyButtonLabel}>Ouvrir la bibliothèque</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Tuile d'accès rapide : vignette collée à gauche + libellé, et un bouton de lecture distinct.
 * Deux zones tactiles imbriquées — le bouton avale son propre tap, le reste ouvre la destination.
 */
function QuickAccessTile({ tile }: { tile: QuickTile }) {
  return (
    <Pressable
      onPress={tile.onOpen}
      android_ripple={{ color: colors.borderStrong }}
      style={({ pressed }) => [styles.tileCard, pressed && styles.tileCardPressed]}
      accessibilityRole="button"
      accessibilityLabel={tile.label}
    >
      {tile.artworkUri !== undefined ? (
        <TrackCover uri={tile.artworkUri} size={52} seed={tile.seed ?? tile.label} />
      ) : (
        <View style={styles.tileIcon}>
          <Icon
            name={tile.icon}
            filled={tile.icon === 'favorite'}
            size={24}
            color={tile.iconColor ?? colors.textSecondary}
          />
        </View>
      )}
      <Text style={styles.tileLabelText} numberOfLines={2}>
        {tile.label}
      </Text>
      {tile.onPlay && (
        <Pressable
          onPress={tile.onPlay}
          hitSlop={8}
          style={styles.tilePlay}
          accessibilityRole="button"
          accessibilityLabel={`Lire ${tile.label}`}
        >
          <Icon name="play_arrow" size={22} color={colors.accent} />
        </Pressable>
      )}
    </Pressable>
  );
}

/** Titre de section, avec une action optionnelle à droite (lien « Tout voir »). */
function SectionHeader({
  label,
  actionLabel,
  onAction,
}: {
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{label}</Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Tuile de statistique (gros chiffre + libellé), même gabarit que l'écran Écoutes. */
function StatTile({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <View style={[styles.tile, wide && styles.tileWide]}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
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
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  headerAction: {
    paddingTop: spacing.xs,
  },
  title: {
    ...typography.display,
  },
  subtitle: {
    ...typography.label,
    marginTop: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.surface,
  },
  // Grille 2 colonnes : `flexBasis` en pourcentage plutôt qu'une largeur calculée, pour suivre
  // n'importe quelle largeur d'écran sans mesure.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
  },
  tileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 0,
    height: 52,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  tileCardPressed: {
    backgroundColor: colors.borderFaint,
  },
  tileIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  tileLabelText: {
    ...typography.heading,
    flex: 1,
    fontSize: 13,
    paddingHorizontal: spacing.sm,
  },
  tilePlay: {
    width: 34,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsCard: {
    marginHorizontal: spacing.xxl,
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  tile: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: 2,
  },
  tileWide: {
    flex: 1.4,
  },
  tileValue: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
  },
  tileLabel: {
    ...typography.body,
    fontSize: 11,
    color: colors.textMuted,
  },
  statsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    paddingTop: spacing.sm,
  },
  statsLinkText: {
    ...typography.label,
    fontSize: 10,
    color: colors.accentLabel,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.accentLabel,
  },
  sectionAction: {
    ...typography.label,
    fontSize: 10,
    color: colors.textMuted,
  },
  recentRow: {
    paddingHorizontal: spacing.xxl,
    gap: spacing.lg,
  },
  recentTile: {
    width: 116,
  },
  recentTitle: {
    ...typography.heading,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  recentArtist: {
    ...typography.body,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  emptyLibrary: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: 40,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
  },
  emptyButtonLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 14,
    color: colors.onAccent,
  },
});
