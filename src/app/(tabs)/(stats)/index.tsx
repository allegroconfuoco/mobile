import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { SegmentedControl } from '@/components/SegmentedControl';
import { showToast } from '@/components/Toast';
import { TrackCover } from '@/components/TrackCover';
import { tapLight } from '@/lib/haptics';
import * as db from '@/library/db';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { usePlayer } from '@/player/PlayerProvider';
import { isIncognitoEnabled, setIncognitoEnabled } from '@/player/playRecorder';
import { buildExportCsv, buildExportJson } from '@/history/exportData';
import { formatDuration } from '@/history/format';
import {
  buildBadges,
  buildHeatmapGrid,
  buildTrend,
  currentStreakDays,
  HEATMAP_DAYS,
  periodStartMs,
  type Badge,
  type StatsPeriod,
  type TrendBucket,
} from '@/history/stats';

/**
 * Onglet Écoutes (issue #25) : tableau de bord des statistiques (période 4 semaines / 6 mois /
 * toujours), tendance, tops, habitudes, découverte — le tout calculé en SQL local, donc
 * hors-ligne. Porte aussi l'entrée vers l'historique complet et le mode « écoute privée ».
 * Graphiques maison (Views), zéro dépendance de chart.
 */

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: '4w', label: '4 semaines' },
  { value: '6m', label: '6 mois' },
  { value: 'all', label: 'Toujours' },
];

const TOP_LIMIT = 5;

type Dashboard = {
  totals: db.PlayTotals;
  trend: TrendBucket[];
  tracks: db.TopTrackRow[];
  artists: db.TopNameRow[];
  albums: db.TopNameRow[];
  heatmap: { grid: number[][]; max: number };
  /** Ratio de découverte — `null` sur « Toujours » (tout serait « nouveau », pas de sens). */
  discovery: { listened: number; discovered: number } | null;
  /** Playlists virtuelles (Wrapped-lite) : calculées à la volée, jamais synchronisées. */
  loop: db.TopTrackRow[];
  year: db.TopTrackRow[];
  /** Badges locaux, toujours calculés depuis toujours (indépendants de la période). */
  badges: Badge[];
};

/** Taille des playlists virtuelles « En boucle » / « Top titres <année> ». */
const VIRTUAL_SIZE = 25;

function loadDashboard(period: StatsPeriod): Dashboard {
  const fromMs = periodStartMs(period);
  const allTime = db.playTotals(null);
  return {
    totals: db.playTotals(fromMs),
    trend: buildTrend(db.listeningByDay(fromMs), period),
    tracks: db.topTracks(fromMs, TOP_LIMIT),
    artists: db.topArtists(fromMs, TOP_LIMIT),
    albums: db.topAlbums(fromMs, TOP_LIMIT),
    heatmap: buildHeatmapGrid(db.listeningHeatmap(fromMs)),
    discovery: fromMs != null ? db.discoveryStats(fromMs) : null,
    loop: db.topTracks(Date.now() - 30 * 86_400_000, VIRTUAL_SIZE),
    year: db.topTracks(new Date(new Date().getFullYear(), 0, 1).getTime(), VIRTUAL_SIZE),
    badges: buildBadges({
      playedMs: allTime.playedMs,
      uniqueTracks: allTime.uniqueTracks,
      uniqueArtists: db.distinctArtistCount(null),
      streakDays: currentStreakDays(db.listeningByDay(null)),
    }),
  };
}

/** Écrit puis partage l'export de l'historique (JSON ou CSV), via la feuille de partage système. */
async function exportHistory(format: 'json' | 'csv'): Promise<void> {
  const rows = db.loadPlayEventsForExport();
  if (rows.length === 0) {
    showToast('Aucune donnée à exporter', 'download');
    return;
  }
  try {
    if (!(await Sharing.isAvailableAsync())) {
      showToast('Partage indisponible sur cet appareil', 'download');
      return;
    }
    const content = format === 'json' ? buildExportJson(rows) : buildExportCsv(rows);
    const file = new File(Paths.cache, `fuoco-historique.${format}`);
    file.create({ overwrite: true });
    file.write(content);
    await Sharing.shareAsync(file.uri, {
      mimeType: format === 'json' ? 'application/json' : 'text/csv',
      dialogTitle: 'Exporter mon historique',
    });
  } catch {
    showToast("Échec de l'export", 'download');
  }
}

export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracksById } = useLibrary();
  const { playQueue } = usePlayer();

  const [period, setPeriod] = useState<StatsPeriod>('4w');
  const [data, setData] = useState<Dashboard>(() => loadDashboard('4w'));
  const [incognito, setIncognito] = useState(() => isIncognitoEnabled());

  // Recalcule à chaque retour sur l'onglet (les écoutes s'accumulent pendant qu'on navigue)
  // et à chaque changement de période. Les agrégats SQL sont bon marché à cette échelle.
  useFocusEffect(
    useCallback(() => {
      setData(loadDashboard(period));
    }, [period])
  );

  const changePeriod = (next: StatsPeriod) => {
    setPeriod(next);
    setData(loadDashboard(next));
  };

  const toggleIncognito = (next: boolean) => {
    tapLight();
    setIncognito(next);
    setIncognitoEnabled(next);
  };

  const playTop = (row: db.TopTrackRow) => {
    const track = row.localTrackId ? tracksById.get(row.localTrackId) : undefined;
    if (!track) {
      showToast('Fichier introuvable sur cet appareil', 'music_off');
      return;
    }
    void playQueue([track], 0, 'stats');
  };

  // Playlist virtuelle : résout les tops en fichiers locaux (les absents sont omis) et joue.
  const playVirtual = (rows: db.TopTrackRow[]) => {
    const tracks = rows
      .map((row) => (row.localTrackId ? tracksById.get(row.localTrackId) : undefined))
      .filter((track): track is LocalTrack => track !== undefined);
    if (tracks.length === 0) {
      showToast('Aucun de ces titres n’est disponible ici', 'music_off');
      return;
    }
    void playQueue(tracks, 0, 'stats');
  };

  const confirmExport = () => {
    Alert.alert(
      'Exporter mes données',
      'Toutes tes écoutes (y compris supprimées, marquées comme telles) dans un fichier à partager ou archiver.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'CSV', onPress: () => void exportHistory('csv') },
        { text: 'JSON', onPress: () => void exportHistory('json') },
      ]
    );
  };

  const { totals, discovery } = data;
  const hasData = totals.plays > 0;
  const skipRate = totals.plays > 0 ? Math.round((totals.skips / totals.plays) * 100) : 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Écoutes</Text>

        <SegmentedControl segments={PERIODS} value={period} onChange={changePeriod} />

        {!hasData ? (
          <View style={styles.empty}>
            <Icon name="graphic_eq" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              Aucune écoute sur cette période. Lance un morceau, tes statistiques apparaîtront ici.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.tiles}>
              <StatTile label="Temps d'écoute" value={formatDuration(totals.playedMs)} wide />
              <StatTile label="Écoutes" value={String(totals.plays)} />
              <StatTile label="Titres" value={String(totals.uniqueTracks)} />
            </View>
            <View style={styles.tiles}>
              <StatTile label="Titres passés" value={`${skipRate} %`} />
              {discovery !== null && discovery.listened > 0 && (
                <StatTile
                  label="Découvertes"
                  value={`${Math.round((discovery.discovered / discovery.listened) * 100)} %`}
                  hint={`${discovery.discovered} nouveau${discovery.discovered > 1 ? 'x' : ''} titre${discovery.discovered > 1 ? 's' : ''}`}
                />
              )}
            </View>

            <SectionTitle label="Tendance" />
            <TrendChart buckets={data.trend} />

            <SectionTitle label="Top titres" />
            {data.tracks.map((row, i) => (
              <Pressable
                key={row.sharedTrackId}
                onPress={() => playTop(row)}
                style={({ pressed }) => [styles.topRow, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Lire ${row.title ?? 'titre inconnu'}`}
              >
                <Text style={styles.rank}>{i + 1}</Text>
                <TrackCover
                  uri={row.artworkUri}
                  size={40}
                  seed={`${row.artist ?? ''}-${row.title ?? ''}`}
                  fallbackIcon={row.localTrackId === null ? 'music_off' : 'music_note'}
                />
                <View style={styles.topText}>
                  <Text style={styles.topLabel} numberOfLines={1}>
                    {row.title ?? 'Titre inconnu'}
                  </Text>
                  <Text style={styles.topHint} numberOfLines={1}>
                    {row.artist ?? 'Artiste inconnu'} · {row.plays} écoute
                    {row.plays > 1 ? 's' : ''}
                  </Text>
                </View>
                <Text style={styles.topDuration}>{formatDuration(row.playedMs)}</Text>
              </Pressable>
            ))}

            <SectionTitle label="Top artistes" />
            {data.artists.map((row, i) => (
              <NameRow key={row.name} rank={i + 1} row={row} />
            ))}

            <SectionTitle label="Top albums" />
            {data.albums.map((row, i) => (
              <NameRow key={`${row.name}-${row.artist ?? ''}`} rank={i + 1} row={row} />
            ))}

            {(data.loop.length > 0 || data.year.length > 0) && (
              <>
                <SectionTitle label="En boucle" />
                {data.loop.length > 0 && (
                  <VirtualPlaylistRow
                    icon="repeat"
                    label="En boucle"
                    hint={`Tes ${data.loop.length} titres les plus écoutés des 30 derniers jours`}
                    onPlay={() => playVirtual(data.loop)}
                  />
                )}
                {data.year.length > 0 && (
                  <VirtualPlaylistRow
                    icon="library_music"
                    label={`Top titres ${new Date().getFullYear()}`}
                    hint={`Tes ${data.year.length} titres les plus écoutés de l'année`}
                    onPlay={() => playVirtual(data.year)}
                  />
                )}
              </>
            )}

            <SectionTitle label="Habitudes" />
            <Heatmap grid={data.heatmap.grid} max={data.heatmap.max} />

            {data.badges.length > 0 && (
              <>
                <SectionTitle label="Badges" />
                <View style={styles.badges}>
                  {data.badges.map((badge) => (
                    <View key={badge.label} style={styles.badge}>
                      <Icon name={badge.icon} size={18} color={colors.accentIcon} />
                      <View>
                        <Text style={styles.badgeLabel}>{badge.label}</Text>
                        <Text style={styles.badgeHint}>{badge.hint}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}

        <SectionTitle label="Données" />
        <View style={styles.list}>
          <Pressable
            onPress={() => router.push('/history')}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Ouvrir l'historique d'écoute"
          >
            <Icon name="history" size={24} color={colors.accentIcon} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Historique</Text>
              <Text style={styles.rowHint}>
                {totals.plays > 0
                  ? `${totals.plays} écoute${totals.plays > 1 ? 's' : ''} sur la période`
                  : 'Aucune écoute pour l’instant'}
              </Text>
            </View>
            <Icon name="chevron_right" size={22} color={colors.textMuted} />
          </Pressable>

          {hasData && (
            <Pressable
              onPress={() => router.push({ pathname: '/share-card', params: { period } })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel="Créer une carte à partager"
            >
              <Icon name="share" size={24} color={colors.accentIcon} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Carte à partager</Text>
                <Text style={styles.rowHint}>Un visuel de tes stats pour les stories</Text>
              </View>
              <Icon name="chevron_right" size={22} color={colors.textMuted} />
            </Pressable>
          )}

          <Pressable
            onPress={confirmExport}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Exporter mes données d'écoute"
          >
            <Icon name="download" size={24} color={colors.accentIcon} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Exporter mes données</Text>
              <Text style={styles.rowHint}>Historique complet en JSON ou CSV</Text>
            </View>
            <Icon name="chevron_right" size={22} color={colors.textMuted} />
          </Pressable>

          <View style={styles.row}>
            <Icon
              name="visibility_off"
              size={24}
              color={incognito ? colors.accent : colors.accentIcon}
            />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Écoute privée</Text>
              <Text style={styles.rowHint}>
                {incognito
                  ? 'Actif — les écoutes ne sont pas enregistrées'
                  : 'Suspend l’enregistrement de l’historique'}
              </Text>
            </View>
            <Switch
              value={incognito}
              onValueChange={toggleIncognito}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor={colors.textPrimary}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionTitle({ label }: { label: string }) {
  return <Text style={styles.sectionTitle}>{label}</Text>;
}

/** Tuile de statistique : gros chiffre + libellé (+ précision optionnelle). */
function StatTile({
  label,
  value,
  hint,
  wide = false,
}: {
  label: string;
  value: string;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <View style={[styles.tile, wide && styles.tileWide]}>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {hint !== undefined && <Text style={styles.tileHint}>{hint}</Text>}
    </View>
  );
}

/** Playlist virtuelle (Wrapped-lite) : calculée à la volée depuis les stats, jouable d'un tap. */
function VirtualPlaylistRow({
  icon,
  label,
  hint,
  onPlay,
}: {
  icon: 'repeat' | 'library_music';
  label: string;
  hint: string;
  onPlay: () => void;
}) {
  return (
    <Pressable
      onPress={onPlay}
      style={({ pressed }) => [styles.virtualRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Lire ${label}`}
    >
      <View style={styles.virtualIcon}>
        <Icon name={icon} size={22} color={colors.accentIcon} />
      </View>
      <View style={styles.topText}>
        <Text style={styles.topLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.topHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <Icon name="play_arrow" size={26} color={colors.accent} />
    </Pressable>
  );
}

/** Ligne de top nominal (artiste / album). */
function NameRow({ rank, row }: { rank: number; row: db.TopNameRow }) {
  return (
    <View style={styles.topRow}>
      <Text style={styles.rank}>{rank}</Text>
      <View style={styles.topText}>
        <Text style={styles.topLabel} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.topHint} numberOfLines={1}>
          {row.artist !== null ? `${row.artist} · ` : ''}
          {row.plays} écoute{row.plays > 1 ? 's' : ''}
        </Text>
      </View>
      <Text style={styles.topDuration}>{formatDuration(row.playedMs)}</Text>
    </View>
  );
}

/** Barres de tendance maison : hauteur proportionnelle au max, labels premier/dernier bucket. */
function TrendChart({ buckets }: { buckets: TrendBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.playedMs), 1);
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  return (
    <View style={styles.chart}>
      <View style={styles.chartBars}>
        {buckets.map((bucket, i) => (
          <View key={i} style={styles.chartBarSlot}>
            <View
              style={[
                styles.chartBar,
                {
                  height: `${Math.max(bucket.playedMs > 0 ? 4 : 0, Math.round((bucket.playedMs / max) * 100))}%`,
                },
              ]}
            />
          </View>
        ))}
      </View>
      {first !== undefined && last !== undefined && (
        <View style={styles.chartAxis}>
          <Text style={styles.chartLabel}>{first.label}</Text>
          <Text style={styles.chartLabel}>{last.label}</Text>
        </View>
      )}
    </View>
  );
}

/** Heatmap 7 jours × 8 tranches de 3 h : intensité = opacité de l'accent. */
function Heatmap({ grid, max }: { grid: number[][]; max: number }) {
  return (
    <View style={styles.heatmap}>
      {grid.map((cells, day) => (
        <View key={day} style={styles.heatmapRow}>
          <Text style={styles.heatmapDay}>{HEATMAP_DAYS[day]}</Text>
          {cells.map((value, slot) => (
            <View
              key={slot}
              style={[
                styles.heatmapCell,
                {
                  backgroundColor: colors.accent,
                  opacity: max > 0 && value > 0 ? 0.15 + 0.85 * (value / max) : 0.06,
                },
              ]}
            />
          ))}
        </View>
      ))}
      <View style={styles.heatmapRow}>
        <Text style={styles.heatmapDay} />
        {['0h', '', '6h', '', '12h', '', '18h', ''].map((label, i) => (
          <Text key={i} style={styles.heatmapSlotLabel}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.display,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.accentLabel,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: 48,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
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
  tileHint: {
    ...typography.body,
    fontSize: 10,
    color: colors.textMuted,
  },
  chart: {
    paddingHorizontal: spacing.xxl,
  },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 96,
    gap: 2,
  },
  chartBarSlot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  chartBar: {
    backgroundColor: colors.accent,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  chartAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
  chartLabel: {
    ...typography.body,
    fontSize: 10,
    color: colors.textMuted,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  rank: {
    ...typography.heading,
    fontSize: 13,
    color: colors.textMuted,
    width: 18,
    textAlign: 'center',
  },
  topText: {
    flex: 1,
    minWidth: 0,
  },
  topLabel: {
    ...typography.heading,
    fontSize: 14,
  },
  topHint: {
    ...typography.body,
    fontSize: 12,
    marginTop: 1,
  },
  topDuration: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  heatmap: {
    paddingHorizontal: spacing.xxl,
    gap: 3,
  },
  heatmapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  heatmapDay: {
    ...typography.body,
    fontSize: 10,
    color: colors.textMuted,
    width: 14,
  },
  heatmapCell: {
    flex: 1,
    aspectRatio: 1.6,
    borderRadius: 3,
  },
  heatmapSlotLabel: {
    ...typography.body,
    flex: 1,
    fontSize: 9,
    color: colors.textMuted,
  },
  virtualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  virtualIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badgeLabel: {
    ...typography.heading,
    fontSize: 13,
  },
  badgeHint: {
    ...typography.body,
    fontSize: 10,
    color: colors.textMuted,
  },
  list: {
    paddingHorizontal: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    ...typography.heading,
  },
  rowHint: {
    ...typography.body,
    fontSize: 12,
    marginTop: 2,
  },
});
