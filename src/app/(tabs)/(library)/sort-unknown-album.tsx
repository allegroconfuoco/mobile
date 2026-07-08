import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import { useAuth } from '@/auth/AuthProvider';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import * as db from '@/library/db';
import { ApiError } from '@/api/auth';
import { buildMatchQuery } from '@/library/matchQuery';
import { resolveMetadata, type ResolvedMetadata } from '@/library/musicbrainzApi';
import { makeAlbumKey, tracksForAlbum, UNKNOWN_ALBUM, UNKNOWN_ARTIST } from '@/library/grouping';

/**
 * Ranger le bac « Album inconnu » d'un artiste (multi-match).
 *
 * Les titres sans tag album atterrissent tous dans « Album inconnu », regroupés par artiste
 * (`albumArtistOf`). Cet écran résout chaque titre **individuellement** via MusicBrainz — l'artiste
 * est connu (c'est la clé du bac), on n'a qu'à parser le titre (`buildMatchQuery`) — et propose de
 * ranger chaque piste dans son **vrai** album, qui peut différer d'une piste à l'autre.
 *
 * Application = overlay immédiat : `saveEnrichment(status:'confirmed', {album,...})`. Comme le tag
 * album est vide, `loadTracks` (`COALESCE(release, tag, e.album)`) fait primer cet album et la piste
 * **se regroupe aussitôt** sous le bon album, sans toucher au fichier. La gravure ID3 dans le MP3
 * reste une action séparée et optionnelle (écran « Écrire dans les fichiers »).
 *
 * Rate limit MusicBrainz (1 req/s en amont, sérialisé côté backend) → résolution **séquentielle**,
 * une piste à la fois, avec arrêt propre sur panne réseau/serveur (comme `enrichEngine`).
 */

type RowStatus = 'pending' | 'resolving' | 'matched' | 'nomatch' | 'error';

type RowState = {
  status: RowStatus;
  match: ResolvedMetadata | null;
  /** Retenu pour l'application groupée (par défaut : un match porteur d'album). */
  selected: boolean;
};

const INITIAL: RowState = { status: 'pending', match: null, selected: false };

export default function SortUnknownAlbumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ artist?: string }>();
  const artist = params.artist ?? UNKNOWN_ARTIST;
  const knownArtist = artist !== UNKNOWN_ARTIST ? artist : null;

  const { tracks, reloadTracks } = useLibrary();
  const { getAccessToken } = useAuth();

  // Bac courant, recalculé depuis la biblio partagée : une piste rangée (ici ou via l'écran de
  // correction) quitte « Album inconnu » et disparaît de la liste au retour.
  const bucket = useMemo(
    () => tracksForAlbum(tracks, makeAlbumKey(artist, UNKNOWN_ALBUM)),
    [tracks, artist]
  );

  // État de résolution, clé par id de piste (survit à un recalcul du bac).
  const [rows, setRows] = useState<Map<string, RowState>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [applying, setApplying] = useState(false);

  const setRow = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) => {
      const next = new Map(prev);
      next.set(id, { ...(next.get(id) ?? INITIAL), ...patch });
      return next;
    });
  }, []);

  // Passe de résolution séquentielle, lancée une seule fois au montage.
  const started = useRef(false);
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    if (started.current || bucket.length === 0) {
      return;
    }
    started.current = true;
    const snapshot = bucket;
    void (async () => {
      setResolving(true);
      try {
        for (const track of snapshot) {
          if (cancelled.current) {
            return;
          }
          const query = buildMatchQuery({
            title: track.title,
            artist: track.artist,
            filename: track.filename,
          });
          const searchArtist = knownArtist ?? query?.artist ?? null;
          const title = query?.title ?? null;
          if (!searchArtist || !title) {
            setRow(track.id, { status: 'nomatch', match: null, selected: false });
            continue;
          }
          setRow(track.id, { status: 'resolving' });
          const token = await getAccessToken();
          if (!token) {
            setError('Session expirée : reconnecte-toi pour lancer la recherche.');
            return;
          }
          const match = await resolveMetadata(token, searchArtist, title);
          if (cancelled.current) {
            return;
          }
          setRow(track.id, {
            status: match ? 'matched' : 'nomatch',
            match,
            // On ne coche par défaut qu'un match porteur d'album (sinon rien à regrouper).
            selected: match?.album != null,
          });
        }
      } catch (e) {
        // Réseau / 401 / 503 (throttle) / 5xx : arrêt propre, ce qui est déjà résolu reste affiché.
        setError(e instanceof ApiError ? e.message : 'La recherche a échoué. Réessaie plus tard.');
      } finally {
        if (!cancelled.current) {
          setResolving(false);
        }
      }
    })();
  }, [bucket, knownArtist, getAccessToken, setRow]);

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const t of bucket) {
      const r = rows.get(t.id);
      if (r?.selected && r.match?.album) {
        n += 1;
      }
    }
    return n;
  }, [bucket, rows]);

  const apply = useCallback(() => {
    setApplying(true);
    const now = Date.now();
    for (const t of bucket) {
      const r = rows.get(t.id);
      if (!r?.selected || !r.match?.album) {
        continue;
      }
      db.saveEnrichment(
        t.id,
        'confirmed',
        {
          mbid: r.match.mbid,
          title: r.match.title,
          artist: r.match.artist,
          album: r.match.album,
          coverArtUrl: r.match.coverArtUrl,
          releaseGroupMbid: r.match.releaseGroupMbid,
        },
        now
      );
    }
    reloadTracks();
    router.back();
  }, [bucket, rows, reloadTracks, router]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Icon name="arrow_back" size={26} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            Ranger les titres
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {artist}
          </Text>
        </View>
      </View>

      <FlatList
        data={bucket}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <View style={styles.intro}>
            <Text style={styles.introText}>
              Chaque titre est identifié via MusicBrainz et rangé dans son album. Touche un titre
              pour corriger le match. L’écriture dans les fichiers reste séparée.
            </Text>
            {resolving && (
              <View style={styles.resolvingRow}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.resolvingText}>Identification en cours…</Text>
              </View>
            )}
            {error && !resolving && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <SortRow
            track={item}
            state={rows.get(item.id) ?? INITIAL}
            onToggle={() => {
              const r = rows.get(item.id);
              if (r?.match?.album) {
                setRow(item.id, { selected: !r.selected });
              }
            }}
            onCorrect={() =>
              router.push({ pathname: '/metadata-fix', params: { trackId: item.id } })
            }
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucun titre à ranger pour cet artiste.</Text>
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          onPress={apply}
          disabled={selectedCount === 0 || applying}
          style={({ pressed }) => [
            styles.applyButton,
            pressed && styles.applyPressed,
            (selectedCount === 0 || applying) && styles.applyDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Ranger ${selectedCount} titre${selectedCount > 1 ? 's' : ''}`}
        >
          <Icon name="check" size={20} color={colors.onAccent} />
          <Text style={styles.applyLabel}>
            {selectedCount > 0
              ? `Ranger ${selectedCount} titre${selectedCount > 1 ? 's' : ''}`
              : 'Rien à ranger'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Une ligne du bac : fichier local à gauche, match proposé + case à droite, tappable pour corriger. */
function SortRow({
  track,
  state,
  onToggle,
  onCorrect,
}: {
  track: LocalTrack;
  state: RowState;
  onToggle: () => void;
  onCorrect: () => void;
}) {
  const hasAlbum = state.match?.album != null;
  return (
    <Pressable
      onPress={onCorrect}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Corriger le match de ${track.title}`}
    >
      <TrackCover
        uri={state.match?.coverArtUrl ?? track.artworkUri}
        size={48}
        fallbackIcon="album"
      />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {state.match?.title ?? track.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {rowMeta(track, state)}
        </Text>
      </View>
      {state.status === 'resolving' ? (
        <ActivityIndicator color={colors.accent} />
      ) : hasAlbum ? (
        <Pressable
          onPress={onToggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: state.selected }}
          accessibilityLabel={state.selected ? 'Ne pas ranger' : 'Ranger'}
        >
          <Icon
            name={state.selected ? 'check_circle' : 'add'}
            size={24}
            color={state.selected ? colors.accentIcon : colors.textMuted}
          />
        </Pressable>
      ) : (
        <Icon name="edit_note" size={22} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

/** Sous-titre d'une ligne : album proposé, ou raison de l'absence de match. */
function rowMeta(track: LocalTrack, state: RowState): string {
  switch (state.status) {
    case 'matched':
      return state.match?.album ?? 'Match sans album — touche pour corriger';
    case 'nomatch':
      return 'Aucun album trouvé — touche pour corriger';
    case 'error':
      return 'Erreur — touche pour réessayer';
    default:
      return track.filename;
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  intro: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  introText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  resolvingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.lg,
  },
  resolvingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  error: {
    ...typography.body,
    color: colors.accent,
    paddingTop: spacing.md,
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
  },
  rowMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  empty: {
    ...typography.body,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
  footer: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  applyPressed: {
    opacity: 0.85,
  },
  applyDisabled: {
    opacity: 0.4,
  },
  applyLabel: {
    ...typography.heading,
    fontSize: 14,
    color: colors.onAccent,
  },
});
