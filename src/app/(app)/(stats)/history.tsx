import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useRouter } from '@/lib/useRouter';

import { colors, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { SearchBar } from '@/components/SearchBar';
import { SegmentedControl } from '@/components/SegmentedControl';
import { showToast } from '@/components/Toast';
import { TrackCover } from '@/components/TrackCover';
import { tapMedium } from '@/lib/haptics';
import * as db from '@/library/db';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlayer } from '@/player/PlayerProvider';
import { dayKey, dayLabel, formatDuration, formatTime } from '@/history/format';

/**
 * Historique d'écoute complet (issue #25) : liste chronologique par jour, recherche (clé
 * normalisée v15, filtrée en SQL), filtre de période, suppression d'une entrée (tombstone,
 * propagée à la synchro) et vidage complet. Tap = rejouer la piste si son fichier est encore là.
 */

type Period = 'all' | '7d' | '30d';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
];

function periodFromMs(period: Period): number | null {
  if (period === '7d') {
    return Date.now() - 7 * 86_400_000;
  }
  if (period === '30d') {
    return Date.now() - 30 * 86_400_000;
  }
  return null;
}

const PAGE_SIZE = 200;

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracksById } = useLibrary();
  const { playQueue } = usePlayer();

  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [rows, setRows] = useState<db.PlayHistoryRow[]>([]);
  // Fin de pagination atteinte (la dernière page était incomplète) : inutile de recharger.
  const endReached = useRef(false);

  const loadFirstPage = useCallback((search: string, from: Period) => {
    const page = db.loadPlayHistory({
      search,
      fromMs: periodFromMs(from),
      limit: PAGE_SIZE,
      offset: 0,
    });
    endReached.current = page.length < PAGE_SIZE;
    setRows(page);
  }, []);

  // Recharge à chaque retour sur l'écran (nouvelles écoutes) et à chaque changement de filtre.
  useFocusEffect(
    useCallback(() => {
      loadFirstPage(query, period);
    }, [loadFirstPage, query, period])
  );

  const loadMore = useCallback(() => {
    if (endReached.current) {
      return;
    }
    setRows((prev) => {
      const page = db.loadPlayHistory({
        search: query,
        fromMs: periodFromMs(period),
        limit: PAGE_SIZE,
        offset: prev.length,
      });
      endReached.current = page.length < PAGE_SIZE;
      return page.length > 0 ? [...prev, ...page] : prev;
    });
  }, [query, period]);

  // Sections par jour, dans l'ordre d'arrivée (les lignes sont déjà triées récentes d'abord).
  const sections = useMemo(() => {
    const byDay = new Map<string, { title: string; data: db.PlayHistoryRow[] }>();
    for (const row of rows) {
      const key = dayKey(row.startedAt);
      let section = byDay.get(key);
      if (!section) {
        section = { title: dayLabel(row.startedAt), data: [] };
        byDay.set(key, section);
      }
      section.data.push(row);
    }
    return [...byDay.values()];
  }, [rows]);

  const replay = useCallback(
    (row: db.PlayHistoryRow) => {
      const track = row.localTrackId ? tracksById.get(row.localTrackId) : undefined;
      if (!track) {
        showToast('Fichier introuvable sur cet appareil', 'music_off');
        return;
      }
      void playQueue([track], 0, 'history');
    },
    [tracksById, playQueue]
  );

  const confirmDeleteRow = useCallback((row: db.PlayHistoryRow) => {
    Alert.alert(
      "Retirer de l'historique",
      `« ${row.title ?? 'Titre inconnu'} » (${formatTime(row.startedAt)}) sera retiré de ton historique d'écoute.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          style: 'destructive',
          onPress: () => {
            tapMedium();
            db.deletePlayEvent(row.id, Date.now());
            setRows((prev) => prev.filter((r) => r.id !== row.id));
            showToast("Écoute retirée de l'historique", 'delete');
          },
        },
      ]
    );
  }, []);

  const confirmClearAll = () => {
    Alert.alert(
      "Vider l'historique",
      'Toutes les écoutes enregistrées seront supprimées, sur cet appareil et à la prochaine synchronisation. Les statistiques repartent de zéro.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Tout supprimer',
          style: 'destructive',
          onPress: () => {
            tapMedium();
            db.clearPlayHistory(Date.now());
            endReached.current = true;
            setRows([]);
            showToast('Historique vidé', 'delete_sweep');
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} />
        {rows.length > 0 && (
          <Pressable
            onPress={confirmClearAll}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Vider l'historique"
          >
            <Icon name="delete_sweep" size={24} color={colors.textPrimary} />
          </Pressable>
        )}
      </View>

      <View style={styles.header}>
        <Text style={styles.title}>Historique</Text>
      </View>

      <SearchBar value={query} onChangeText={setQuery} placeholder="Titre, artiste, album…" />

      <View style={styles.periodBar}>
        <SegmentedControl segments={PERIODS} value={period} onChange={setPeriod} />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(row) => row.id}
        stickySectionHeadersEnabled={false}
        windowSize={7}
        initialNumToRender={12}
        maxToRenderPerBatch={16}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <HistoryRow row={item} onPress={replay} onLongPress={confirmDeleteRow} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="history" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {query.trim() !== '' || period !== 'all'
                ? 'Aucune écoute ne correspond à ces filtres.'
                : 'Aucune écoute enregistrée pour l’instant. Lance un morceau, il apparaîtra ici.'}
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

/** Une écoute : pochette, titre/artiste, heure + temps écouté (« passé » si skip). */
function HistoryRow({
  row,
  onPress,
  onLongPress,
}: {
  row: db.PlayHistoryRow;
  onPress: (row: db.PlayHistoryRow) => void;
  onLongPress: (row: db.PlayHistoryRow) => void;
}) {
  const unavailable = row.localTrackId === null;
  return (
    <Pressable
      onPress={() => onPress(row)}
      onLongPress={() => onLongPress(row)}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title ?? 'Titre inconnu'}, écouté à ${formatTime(row.startedAt)}`}
    >
      <TrackCover
        uri={row.artworkUri}
        size={44}
        seed={`${row.artist ?? ''}-${row.title ?? ''}`}
        fallbackIcon={unavailable ? 'music_off' : 'music_note'}
      />
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, unavailable && styles.rowTitleUnavailable]}
          numberOfLines={1}
        >
          {row.title ?? 'Titre inconnu'}
        </Text>
        <Text style={styles.rowHint} numberOfLines={1}>
          {row.artist ?? 'Artiste inconnu'}
          {row.album ? ` · ${row.album}` : ''}
        </Text>
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.rowTime}>{formatTime(row.startedAt)}</Text>
        <Text style={styles.rowPlayed}>{row.skipped ? 'passé' : formatDuration(row.playedMs)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.xxl,
  },
  header: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.display,
  },
  periodBar: {
    paddingTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.accentLabel,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...typography.heading,
    fontSize: 14,
  },
  rowTitleUnavailable: {
    color: colors.textMuted,
  },
  rowHint: {
    ...typography.body,
    fontSize: 12,
    marginTop: 2,
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rowTime: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  rowPlayed: {
    ...typography.body,
    fontSize: 11,
    color: colors.textMuted,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingTop: 64,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
});
