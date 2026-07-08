import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import { useAuth } from '@/auth/AuthProvider';
import { useLibrary } from '@/library/LibraryProvider';
import * as db from '@/library/db';
import { ApiError } from '@/api/auth';
import {
  fetchAlbumCandidates,
  fetchRelease,
  type Release,
  type ReleaseCandidate,
} from '@/library/musicbrainzApi';
import { matchReleaseTracks, type ReleaseMapping } from '@/library/albumMatch';
import { makeAlbumKey, tracksForAlbum, UNKNOWN_ALBUM, UNKNOWN_ARTIST } from '@/library/grouping';

/**
 * Identification d'album via une release MusicBrainz (issue #23) — flow façon Picard, in-app.
 *
 * Beaucoup de fichiers téléchargés n'ont pas de tag `TRCK`/`TPOS` : l'album retombe alors sur un
 * tri alphabétique. Ici l'utilisateur identifie l'album (une release précise), on récupère la
 * tracklist **ordonnée** et on la stocke dans un overlay local (`track_enrichment`, `source=release`)
 * qui prime sur les tags fichier — l'ordre se corrige sans toucher à `grouping.ts`. Réversible.
 *
 * Poussé depuis le détail album, avec `artist` (album artist) + `title` (album) en params : on
 * re-dérive les pistes locales depuis la biblio partagée, aucune donnée dupliquée.
 */
export default function IdentifyAlbumScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ artist?: string; title?: string }>();
  const artist = params.artist ?? UNKNOWN_ARTIST;
  const title = params.title ?? UNKNOWN_ALBUM;

  const { tracks, reloadTracks } = useLibrary();
  const { getAccessToken } = useAuth();

  const albumTracks = useMemo(
    () => tracksForAlbum(tracks, makeAlbumKey(artist, title)),
    [tracks, artist, title]
  );
  const trackIds = useMemo(() => albumTracks.map((t) => t.id), [albumTracks]);

  // Album déjà identifié ? (au moins un overlay release sur ses pistes) → propose la réinitialisation.
  const alreadyIdentified = useMemo(() => db.countReleaseOverlays(trackIds) > 0, [trackIds]);

  // Termes de recherche éditables (préremplis depuis les tags) : les tags d'un album peuvent être
  // approximatifs, l'utilisateur doit pouvoir rectifier et relancer.
  const [albumInput, setAlbumInput] = useState(title);
  const [artistInput, setArtistInput] = useState(artist);

  const [candidates, setCandidates] = useState<ReleaseCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Release sélectionnée + mapping local↔release (écran de validation).
  const [release, setRelease] = useState<Release | null>(null);
  const [mapping, setMapping] = useState<ReleaseMapping[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCandidates = useCallback(async () => {
    const album = albumInput.trim();
    const albumArtist = artistInput.trim();
    if (!album && !albumArtist) {
      setError('Renseigne au moins un album ou un artiste.');
      setCandidates(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setError('Session expirée : reconnecte-toi pour identifier l’album.');
        return;
      }
      // Le compte/les titres locaux affinent la recherche (le backend tente le compte exact puis
      // relâche) sans dépendre des termes édités, qui ne changent que la requête, pas l'album ciblé.
      const found = await fetchAlbumCandidates(token, {
        albumArtist,
        album,
        trackCount: albumTracks.length,
        trackTitles: albumTracks.map((t) => t.title),
      });
      setCandidates(found);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'La recherche a échoué. Réessaie plus tard.');
    } finally {
      setLoading(false);
    }
  }, [albumInput, artistInput, getAccessToken, albumTracks]);

  // Recherche automatique au montage (l'utilisateur a déjà exprimé son intention en ouvrant l'écran).
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void loadCandidates();
    }
  }, [loadCandidates]);

  // Sélection d'un candidat → chargement de la tracklist ordonnée + mapping local↔release.
  const selectCandidate = useCallback(
    async (candidate: ReleaseCandidate) => {
      setBusy(true);
      setError(null);
      try {
        const token = await getAccessToken();
        if (!token) {
          setError('Session expirée : reconnecte-toi.');
          return;
        }
        const found = await fetchRelease(token, candidate.mbid);
        if (!found) {
          setError('Cet album n’a pas pu être chargé. Choisis-en un autre.');
          return;
        }
        setRelease(found);
        setMapping(matchReleaseTracks(found.tracks, albumTracks));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Le chargement a échoué. Réessaie plus tard.');
      } finally {
        setBusy(false);
      }
    },
    [getAccessToken, albumTracks]
  );

  // Écrit l'overlay pour chaque piste locale mappée, puis rafraîchit la biblio et referme.
  const applyMapping = useCallback(() => {
    if (!release || !mapping) {
      return;
    }
    const entries: db.AlbumOverlayEntry[] = [];
    for (const m of mapping) {
      if (m.local) {
        entries.push({
          trackId: m.local.id,
          releaseMbid: release.mbid,
          recordingMbid: m.release.recordingMbid,
          album: release.title || null,
          albumArtist: release.artist,
          trackNo: m.release.position,
          discNo: m.release.discNo,
          coverArtUrl: release.coverArtUrl,
        });
      }
    }
    db.saveAlbumOverlays(entries, Date.now());
    reloadTracks();
    router.back();
  }, [release, mapping, reloadTracks, router]);

  const resetIdentification = useCallback(() => {
    db.resetAlbumOverlay(trackIds);
    reloadTracks();
    router.back();
  }, [trackIds, reloadTracks, router]);

  const backToCandidates = useCallback(() => {
    setRelease(null);
    setMapping(null);
    setError(null);
  }, []);

  const multiDisc = useMemo(
    () => (release ? release.tracks.some((t) => t.discNo > 1) : false),
    [release]
  );
  const matchedCount = mapping ? mapping.filter((m) => m.local).length : 0;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          onPress={() => (release ? backToCandidates() : router.back())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Icon name="arrow_back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {release ? 'Valider l’album' : 'Identifier l’album'}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Album local visé. */}
          <View style={styles.albumCard}>
            <Text style={styles.albumTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.albumMeta} numberOfLines={1}>
              {artist} · {albumTracks.length} {albumTracks.length > 1 ? 'titres' : 'titre'}
            </Text>
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          {/* Phase validation : release choisie + mapping. */}
          {release && mapping ? (
            <>
              <View style={styles.releaseHead}>
                <TrackCover uri={release.coverArtUrl} size={64} fallbackIcon="album" />
                <View style={styles.releaseHeadText}>
                  <Text style={styles.releaseTitle} numberOfLines={2}>
                    {release.title}
                  </Text>
                  <Text style={styles.releaseArtist} numberOfLines={1}>
                    {release.artist ?? UNKNOWN_ARTIST}
                  </Text>
                  <Text style={styles.matchSummary}>
                    {matchedCount}/{mapping.length} piste{mapping.length > 1 ? 's' : ''} associée
                    {matchedCount > 1 ? 's' : ''}
                  </Text>
                </View>
              </View>

              <View style={styles.list}>
                {mapping.map((m, i) => (
                  <View
                    key={`${m.release.discNo}-${m.release.position}-${i}`}
                    style={styles.mapRow}
                  >
                    <Text style={styles.posLabel}>
                      {multiDisc ? `${m.release.discNo}-${m.release.position}` : m.release.position}
                    </Text>
                    <View style={styles.mapText}>
                      <Text style={styles.mapReleaseTitle} numberOfLines={1}>
                        {m.release.title}
                      </Text>
                      {m.local ? (
                        <Text style={styles.mapLocal} numberOfLines={1}>
                          {m.local.title}
                        </Text>
                      ) : (
                        <View style={styles.missingRow}>
                          <Icon name="warning" size={13} color={colors.textMuted} />
                          <Text style={styles.mapMissing}>Aucun fichier local</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>

              <Pressable
                onPress={applyMapping}
                disabled={matchedCount === 0}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryPressed,
                  matchedCount === 0 && styles.buttonDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Appliquer cette identification"
              >
                <Icon name="check" size={20} color={colors.onAccent} />
                <Text style={styles.primaryLabel}>Appliquer l’ordre</Text>
              </Pressable>
              <Pressable
                onPress={backToCandidates}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Choisir un autre album"
              >
                <Text style={styles.secondaryLabel}>Choisir un autre</Text>
              </Pressable>
            </>
          ) : (
            <>
              {/* Termes de recherche éditables : rectifier un tag album/artiste approximatif. */}
              <View style={styles.searchCard}>
                <TextInput
                  value={albumInput}
                  onChangeText={setAlbumInput}
                  placeholder="Album"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  autoCapitalize="words"
                  returnKeyType="search"
                />
                <TextInput
                  value={artistInput}
                  onChangeText={setArtistInput}
                  placeholder="Artiste de l’album"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={() => void loadCandidates()}
                />
                <Pressable
                  onPress={() => void loadCandidates()}
                  disabled={loading || busy}
                  style={({ pressed }) => [
                    styles.searchButton,
                    pressed && styles.secondaryPressed,
                    (loading || busy) && styles.buttonDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Rechercher l’album"
                >
                  <Icon name="search" size={20} color={colors.textPrimary} />
                  <Text style={styles.secondaryLabel}>Rechercher</Text>
                </Pressable>
              </View>

              {/* Phase candidats. */}
              {(loading || busy) && (
                <View style={styles.centerState}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.stateText}>{busy ? 'Chargement…' : 'Recherche…'}</Text>
                </View>
              )}

              {!loading && !busy && candidates && candidates.length === 0 && (
                <Text style={styles.empty}>
                  Aucun album trouvé. Vérifie le nom de l’album et de l’artiste dans les tags.
                </Text>
              )}

              {!busy &&
                candidates?.map((c) => (
                  <Pressable
                    key={c.mbid}
                    onPress={() => void selectCandidate(c)}
                    style={({ pressed }) => [styles.candidateRow, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Choisir ${c.title}${c.artist ? `, ${c.artist}` : ''}`}
                  >
                    <TrackCover uri={c.coverArtUrl} size={52} fallbackIcon="album" />
                    <View style={styles.candidateText}>
                      <Text style={styles.candidateTitle} numberOfLines={1}>
                        {c.title}
                      </Text>
                      <Text style={styles.candidateMeta} numberOfLines={1}>
                        {[c.artist, c.year?.toString(), trackCountLabel(c.trackCount)]
                          .filter(Boolean)
                          .join(' · ') || UNKNOWN_ARTIST}
                      </Text>
                    </View>
                    <Icon name="chevron_right" size={22} color={colors.textMuted} />
                  </Pressable>
                ))}

              {/* Réinitialisation d'une identification précédente. */}
              {alreadyIdentified && (
                <Pressable
                  onPress={resetIdentification}
                  style={({ pressed }) => [styles.resetButton, pressed && styles.secondaryPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Réinitialiser l’identification"
                >
                  <Icon name="restart_alt" size={20} color={colors.textSecondary} />
                  <Text style={styles.resetLabel}>Réinitialiser (revenir aux tags)</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function trackCountLabel(count: number | null): string | null {
  return count != null ? `${count} titres` : null;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  searchCard: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  input: {
    ...typography.heading,
    fontSize: 15,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  title: {
    ...typography.title,
    flex: 1,
    minWidth: 0,
  },
  albumCard: {
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  albumTitle: {
    ...typography.heading,
  },
  albumMeta: {
    ...typography.body,
    fontSize: 12,
    marginTop: 2,
  },
  centerState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  stateText: {
    ...typography.body,
    textAlign: 'center',
  },
  empty: {
    ...typography.body,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
  },
  error: {
    ...typography.body,
    color: colors.accent,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  candidateText: {
    flex: 1,
    minWidth: 0,
  },
  candidateTitle: {
    ...typography.heading,
  },
  candidateMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  releaseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.md,
  },
  releaseHeadText: {
    flex: 1,
    minWidth: 0,
  },
  releaseTitle: {
    ...typography.heading,
    fontSize: 16,
  },
  releaseArtist: {
    ...typography.body,
    fontSize: 12,
    marginTop: 2,
  },
  matchSummary: {
    ...typography.label,
    fontSize: 10,
    color: colors.accentLabel,
    marginTop: spacing.xs,
  },
  list: {
    paddingHorizontal: spacing.xxl,
  },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  posLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    minWidth: 32,
  },
  mapText: {
    flex: 1,
    minWidth: 0,
  },
  mapReleaseTitle: {
    ...typography.heading,
    fontSize: 14,
  },
  mapLocal: {
    ...typography.body,
    fontSize: 12,
    marginTop: 2,
  },
  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  mapMissing: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xxl,
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  primaryLabel: {
    ...typography.heading,
    fontSize: 14,
    color: colors.onAccent,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xxl,
    marginTop: spacing.md,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  secondaryPressed: {
    backgroundColor: colors.surface,
  },
  secondaryLabel: {
    ...typography.heading,
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xxl,
    marginTop: spacing.xxl,
    paddingVertical: spacing.md,
  },
  resetLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
