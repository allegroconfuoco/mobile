/**
 * Écran de **revue avant gravure** (write-back ID3) — 1 piste ou lot (album / artiste / playlist /
 * bibliothèque). Intercalé entre le menu « Écrire dans le fichier » et l'écriture réelle : on voit,
 * par champ, la valeur du tag fichier et celle de MusicBrainz, on choisit la source ou on saisit à
 * la main, puis on grave. Rien n'est écrit tant que l'utilisateur ne valide pas.
 *
 * Paramètres de route :
 *  - `trackId` : mode 1 piste ;
 *  - `scope` = `album` (+`albumArtist`+`album`) | `artist` (+`artist`) | `playlist` (+`playlistId`) |
 *    `library` : mode lot, la liste de pistes est reconstruite localement.
 *
 * L'état de revue (`TrackReview[]`, modèle pur `writeReview`) est initialisé une fois au montage ;
 * la gravure sérialise les pistes (`graveTags` une par une) et s'arrête au premier refus de
 * permission pour éviter d'empiler les dialogues système.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import { TrackTagEditor } from '@/components/TrackTagEditor';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import { makeAlbumKey, tracksForAlbum, tracksForArtist } from '@/library/grouping';
import type { LocalTrack } from '@/library/useAudioLibrary';
import * as db from '@/library/db';
import {
  initTrackReview,
  reviewToTags,
  setAllSources,
  type TrackReview,
} from '@/library/writeReview';
import { alertPermissionNeeded, graveMany, type WriteSpec } from '@/library/writeTags';
import { colors, fontFamily, radii, spacing, typography } from '@/theme';

type Params = {
  trackId?: string;
  scope?: string;
  albumArtist?: string;
  album?: string;
  artist?: string;
  playlistId?: string;
  /** Libellé lisible du lot (nom d'album/artiste/playlist), pour l'en-tête. */
  label?: string;
};

const EMPTY_BASE: db.TagBackup = {
  title: null,
  artist: null,
  album: null,
  albumArtist: null,
  trackNo: null,
  discNo: null,
};

export default function WriteTagsScreen() {
  const params = useLocalSearchParams<Params>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tracks, tracksById, reloadTracks } = useLibrary();
  const { getEntries } = usePlaylistsContext();

  // Liste cible résolue **une fois** (au premier rendu) selon le scope.
  const [targets] = useState<LocalTrack[]>(() => {
    if (params.trackId) {
      const t = tracksById.get(params.trackId);
      return t ? [t] : [];
    }
    switch (params.scope) {
      case 'album':
        return tracksForAlbum(tracks, makeAlbumKey(params.albumArtist ?? '', params.album ?? ''));
      case 'artist':
        return tracksForArtist(tracks, params.artist ?? '');
      case 'playlist':
        return getEntries(params.playlistId ?? '')
          .map((e) => (e.localTrackId ? tracksById.get(e.localTrackId) : undefined))
          .filter((t): t is LocalTrack => !!t);
      case 'library':
        return tracks;
      default:
        return [];
    }
  });

  const targetsById = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);

  // État de revue, une entrée par piste : base (tag fichier) + MusicBrainz (overlay), en 2 requêtes.
  const [reviews, setReviews] = useState<TrackReview[]>(() => {
    const ids = targets.map((t) => t.id);
    const base = db.loadBaseTagsMany(ids);
    const mb = db.loadMbTagsMany(ids);
    return targets.map((t) =>
      initTrackReview(t, base.get(t.id) ?? EMPTY_BASE, mb.get(t.id) ?? null)
    );
  });

  // Carte dépliée en mode lot (une seule à la fois), ou null.
  const [expanded, setExpanded] = useState<string | null>(
    targets.length === 1 ? targets[0].id : null
  );
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState(0);

  const isBatch = targets.length > 1;

  const updateReview = (next: TrackReview) =>
    setReviews((rs) => rs.map((r) => (r.trackId === next.trackId ? next : r)));

  const applyAll = (source: 'file' | 'mb') =>
    setReviews((rs) => rs.map((r) => setAllSources(r, source)));

  const write = async () => {
    if (writing || reviews.length === 0) {
      return;
    }
    setWriting(true);
    setProgress(0);

    // Pistes disparues entre le montage et la gravure (rare) : comptées en échec.
    const items: { track: LocalTrack; spec: WriteSpec }[] = [];
    for (const r of reviews) {
      const track = targetsById.get(r.trackId);
      if (track) {
        items.push({ track, spec: { tags: reviewToTags(r), cover: r.cover } });
      }
    }
    const missing = reviews.length - items.length;

    const outcome = await graveMany(items, setProgress);

    setWriting(false);
    reloadTracks();

    if (outcome.permission) {
      alertPermissionNeeded('Relance ensuite l’écriture.');
      return;
    }
    const failed = outcome.failed + missing;
    if (failed === 0) {
      showToast(
        outcome.written > 1
          ? `${outcome.written} pistes écrites dans les fichiers`
          : 'Infos écrites dans le fichier',
        'save'
      );
      router.back();
    } else {
      Alert.alert('Écriture partielle', `${outcome.written} écrite(s), ${failed} en échec.`);
    }
  };

  const writeLabel = writing
    ? isBatch
      ? `Écriture… ${progress}/${reviews.length}`
      : 'Écriture…'
    : isBatch
      ? `Écrire ${reviews.length} pistes`
      : 'Écrire dans le fichier';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {isBatch ? 'Écrire dans les fichiers' : 'Écrire dans le fichier'}
          </Text>
          {(params.label || isBatch) && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {params.label ?? `${reviews.length} pistes`}
            </Text>
          )}
        </View>
      </View>

      {reviews.length === 0 ? (
        <View style={styles.centered}>
          <Icon name="music_off" size={40} color={colors.textMuted} />
          <Text style={styles.stateText}>Aucune piste à écrire.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {isBatch ? (
            <FlatList
              data={reviews}
              keyExtractor={(r) => r.trackId}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                <View style={styles.toolbar}>
                  <Text style={styles.toolbarLabel}>Tout mettre en</Text>
                  <Pressable
                    onPress={() => applyAll('file')}
                    style={({ pressed }) => [styles.toolbarBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.toolbarBtnLabel}>Fichier</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => applyAll('mb')}
                    style={({ pressed }) => [styles.toolbarBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.toolbarBtnLabel}>MusicBrainz</Text>
                  </Pressable>
                </View>
              }
              renderItem={({ item }) => {
                const open = expanded === item.trackId;
                const resolved = reviewToTags(item);
                return (
                  <View style={styles.card}>
                    <Pressable
                      onPress={() => setExpanded(open ? null : item.trackId)}
                      style={styles.cardHeader}
                      accessibilityRole="button"
                    >
                      <View style={styles.cardHeaderText}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {resolved.title ?? item.filename}
                        </Text>
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {[resolved.artist, resolved.album].filter(Boolean).join(' · ') ||
                            item.filename}
                        </Text>
                      </View>
                      <Icon
                        name={open ? 'expand_less' : 'expand_more'}
                        size={22}
                        color={colors.textSecondary}
                      />
                    </Pressable>
                    {open && (
                      <View style={styles.cardBody}>
                        <TrackTagEditor review={item} onChange={updateReview} />
                      </View>
                    )}
                  </View>
                );
              }}
            />
          ) : (
            <ScrollView
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <TrackTagEditor review={reviews[0]} onChange={updateReview} />
              <Text style={styles.note}>
                Les tags d’origine sont sauvegardés à la première écriture : tu pourras restaurer.
              </Text>
            </ScrollView>
          )}

          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <Pressable
              onPress={() => void write()}
              disabled={writing}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                writing && styles.buttonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={writeLabel}
            >
              {writing ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Icon name="save" size={20} color={colors.onAccent} />
              )}
              <Text style={styles.primaryLabel}>{writeLabel}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1 },
  title: typography.title,
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stateText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    color: colors.textSecondary,
  },
  listContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  toolbarLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    color: colors.textMuted,
  },
  toolbarBtn: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toolbarBtnLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeaderText: { flex: 1 },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  cardMeta: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cardBody: {
    padding: spacing.md,
    paddingTop: 0,
  },
  note: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.lg,
    lineHeight: 18,
  },
  footer: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  primaryLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    color: colors.onAccent,
  },
  buttonDisabled: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
