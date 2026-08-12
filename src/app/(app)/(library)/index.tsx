import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useRouter } from '@/lib/useRouter';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { MenuButton } from '@/components/MenuButton';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ResumeCard } from '@/components/ResumeCard';
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
 * Écran d'accueil (Dashboard) — remplace l'ancienne page bibliothèque (déplacée en `library.tsx`,
 * accessible depuis le menu latéral). Rassemble ce qu'on veut sous la main au lancement : reprise
 * inter-appareils, résumé des écoutes, accès playlists/favoris, playlists virtuelles (En boucle /
 * Top année, calculées à la volée comme dans l'onglet Écoutes) et les derniers titres ajoutés.
 *
 * Rien n'est synchronisé ni stocké ici : tout est dérivé de l'état local (bibliothèque, playlists,
 * favoris) et des agrégats SQL d'écoute, recalculés au focus seulement si l'historique a bougé.
 */

/** Taille des playlists virtuelles (mêmes bornes que l'onglet Écoutes). */
const VIRTUAL_SIZE = 25;
const RECENT_LIMIT = 12;

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

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracks, tracksById } = useLibrary();
  const { playlists } = usePlaylistsContext();
  const { favoriteIds } = useFavorites();
  const { playQueue } = usePlayer();

  // Agrégats d'écoute : calculés une fois, recalculés au focus seulement si `play_events` a bougé
  // (même compteur de version que l'onglet Écoutes) — un retour sur l'accueil sans nouvelle écoute
  // ne refait aucun travail SQL.
  const [data, setData] = useState<DashboardData>(() => loadDashboardData());
  const [computedAt, setComputedAt] = useState(() => db.getPlayEventsVersion());
  useFocusEffect(
    useCallback(() => {
      if (db.getPlayEventsVersion() === computedAt) {
        return;
      }
      setComputedAt(db.getPlayEventsVersion());
      setData(loadDashboardData());
    }, [computedAt])
  );

  // Derniers titres ajoutés au media store (indépendant des écoutes).
  const recent = useMemo(
    () =>
      [...tracks]
        .sort((a, b) => (b.creationTime ?? 0) - (a.creationTime ?? 0))
        .slice(0, RECENT_LIMIT),
    [tracks]
  );
  const recentPlaylists = playlists.slice(0, 3);

  // Résout une playlist virtuelle (tops → fichiers locaux, absents omis) puis joue.
  const playVirtual = (rows: db.TopTrackRow[]) => {
    const resolved = rows
      .map((row) => (row.localTrackId ? tracksById.get(row.localTrackId) : undefined))
      .filter((t): t is LocalTrack => t !== undefined);
    if (resolved.length === 0) {
      showToast('Aucun de ces titres n’est disponible ici', 'music_off');
      return;
    }
    void playQueue(resolved, 0, 'library');
  };

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
        </View>

        {/* Réseau absent : l'app fonctionne, seule la synchro est en attente. */}
        <OfflineBanner />

        {/* Reprise inter-appareils (#25) : bannière si une écoute est à reprendre. */}
        <ResumeCard />

        {/* Résumé des écoutes (tout l'historique) — raccourci vers l'onglet Écoutes. */}
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

        {/* Playlists & favoris. */}
        <SectionHeader
          label="Playlists"
          actionLabel="Tout voir"
          onAction={() => router.push({ pathname: '/library', params: { view: 'playlists' } })}
        />
        <ShortcutRow
          icon="favorite"
          filled
          iconColor={colors.accent}
          label="Favoris"
          meta={countLabel(favoriteIds.size, 'titre')}
          onPress={() => router.push('/favorites')}
        />
        {recentPlaylists.map((playlist) => (
          <ShortcutRow
            key={playlist.id}
            icon="queue_music"
            label={playlist.name}
            meta={countLabel(playlist.trackCount, 'titre')}
            onPress={() => router.push({ pathname: '/playlist', params: { id: playlist.id } })}
          />
        ))}

        {/* Playlists virtuelles (Wrapped-lite), jouables d'un tap. */}
        {(data.loop.length > 0 || data.year.length > 0) && (
          <>
            <SectionHeader label="À réécouter" />
            {data.loop.length > 0 && (
              <VirtualRow
                icon="repeat"
                label="En boucle"
                hint={`Tes ${data.loop.length} titres les plus écoutés du mois`}
                onPlay={() => playVirtual(data.loop)}
              />
            )}
            {data.year.length > 0 && (
              <VirtualRow
                icon="library_music"
                label={`Top titres ${new Date().getFullYear()}`}
                hint={`Tes ${data.year.length} titres les plus écoutés de l'année`}
                onPlay={() => playVirtual(data.year)}
              />
            )}
          </>
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
              {recent.map((track) => (
                <Pressable
                  key={track.id}
                  onPress={() => void playQueue([track], 0, 'library')}
                  style={styles.recentTile}
                  accessibilityRole="button"
                  accessibilityLabel={`Lire ${track.title}`}
                >
                  <TrackCover
                    uri={track.artworkUri}
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

/** Tuile de statistique (gros chiffre + libellé), même gabarit que l'onglet Écoutes. */
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

/** Ligne de raccourci (favoris / playlist) : icône + nom + compteur. */
function ShortcutRow({
  icon,
  filled = false,
  iconColor = colors.textSecondary,
  label,
  meta,
  onPress,
}: {
  icon: IconName;
  filled?: boolean;
  iconColor?: string;
  label: string;
  meta: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.borderStrong }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} filled={filled} size={22} color={iconColor} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Icon name="chevron_right" size={22} color={colors.textMuted} />
    </Pressable>
  );
}

/** Ligne de playlist virtuelle, jouable d'un tap. */
function VirtualRow({
  icon,
  label,
  hint,
  onPlay,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPlay: () => void;
}) {
  return (
    <Pressable
      onPress={onPlay}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Lire ${label}`}
    >
      <View style={styles.virtualIcon}>
        <Icon name={icon} size={22} color={colors.accentIcon} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <Icon name="play_arrow" size={26} color={colors.accent} />
    </Pressable>
  );
}

/** Libellé « N titre(s) ». */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count > 1 ? 's' : ''}`;
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
  statsCard: {
    marginHorizontal: spacing.xxl,
    marginTop: spacing.md,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    ...typography.heading,
  },
  rowMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  virtualIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
