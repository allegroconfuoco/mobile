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
import { BottomSheet } from '@/components/BottomSheet';
import { useAuth } from '@/auth/AuthProvider';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import * as db from '@/library/db';
import { ApiError } from '@/api/auth';
import {
  fetchAlbumCandidates,
  fetchRelease,
  type Release,
  type ReleaseCandidate,
} from '@/library/musicbrainzApi';
import { matchReleaseTracks, reassignMapping, type ReleaseMapping } from '@/library/albumMatch';
import {
  makeAlbumKey,
  normalizeForSearch,
  tracksForAlbum,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
} from '@/library/grouping';

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
  const params = useLocalSearchParams<{ artist?: string; title?: string; trackId?: string }>();
  // Deux modes. Album : identification d'un album local déjà regroupé (params artist+title). Titre
  // seul : rattachement d'UN titre à un album (param trackId) — le fichier peut être mal ou pas
  // taggé, on part alors de la piste elle-même, pas d'une clé d'album (qui serait fausse).
  const singleTrackId = params.trackId ?? null;
  const singleTrack = singleTrackId !== null;
  const albumKeyArtist = params.artist ?? UNKNOWN_ARTIST;
  const albumKeyTitle = params.title ?? UNKNOWN_ALBUM;

  const { tracks, reloadTracks } = useLibrary();
  const { getAccessToken } = useAuth();

  const albumTracks = useMemo(
    () =>
      singleTrack
        ? tracks.filter((t) => t.id === singleTrackId)
        : tracksForAlbum(tracks, makeAlbumKey(albumKeyArtist, albumKeyTitle)),
    [tracks, singleTrack, singleTrackId, albumKeyArtist, albumKeyTitle]
  );
  const trackIds = useMemo(() => albumTracks.map((t) => t.id), [albumTracks]);

  // En-tête : le titre à rattacher (mode titre seul) ou le nom de l'album visé (mode album).
  const focusTrack = singleTrack ? (albumTracks[0] ?? null) : null;
  const headerTitle = singleTrack ? (focusTrack?.title ?? '…') : albumKeyTitle;
  const headerArtist = singleTrack ? (focusTrack?.artist ?? UNKNOWN_ARTIST) : albumKeyArtist;

  // Album déjà identifié ? (au moins un overlay release sur ses pistes) → propose la réinitialisation.
  const alreadyIdentified = useMemo(() => db.countReleaseOverlays(trackIds) > 0, [trackIds]);

  // Termes de recherche éditables (préremplis depuis les tags) : les tags d'un album peuvent être
  // approximatifs, l'utilisateur doit pouvoir rectifier et relancer.
  // En mode titre seul, on ne pré-remplit l'album que s'il paraît fiable : un tag album absent ou
  // égal au titre (le cas faux le plus courant) amorcerait la recherche release sur une mauvaise
  // piste. L'artiste, lui, est fiable et sert de socle à la recherche par artiste.
  const [albumInput, setAlbumInput] = useState(() =>
    singleTrack ? guessAlbumInput(focusTrack) : albumKeyTitle
  );
  const [artistInput, setArtistInput] = useState(() =>
    singleTrack ? (focusTrack?.artist ?? '') : albumKeyArtist
  );

  const [candidates, setCandidates] = useState<ReleaseCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Release sélectionnée + mapping local↔release (écran de validation).
  const [release, setRelease] = useState<Release | null>(null);
  const [mapping, setMapping] = useState<ReleaseMapping[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Index de la piste de release dont on corrige le fichier local à la main (feuille de choix).
  const [pickerFor, setPickerFor] = useState<number | null>(null);

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
      // Mode album : le compte de pistes locales affine la recherche (le backend tente le compte
      // exact `tracks:N` puis relâche si zéro résultat) — bon signal quand l'album local est complet.
      // Mode titre seul : on l'omet **volontairement**. On cherche l'album qui *contient* ce titre
      // (8, 12 pistes…), pas une release d'1 titre ; envoyer `trackCount=1` ferait remonter les
      // singles (`tracks:1` renvoie des résultats, donc le repli sans compte ne se déclenche jamais)
      // et masquerait le vrai album. On n'envoie pas non plus les titres, dont le backend redérive
      // le compte.
      const found = await fetchAlbumCandidates(token, {
        albumArtist,
        album,
        ...(singleTrack
          ? {}
          : { trackCount: albumTracks.length, trackTitles: albumTracks.map((t) => t.title) }),
      });
      setCandidates(found);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'La recherche a échoué. Réessaie plus tard.');
    } finally {
      setLoading(false);
    }
  }, [albumInput, artistInput, getAccessToken, albumTracks, singleTrack]);

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

  // Correction manuelle : associe (ou libère, `local = null`) le fichier local de la piste de
  // release ciblée par la feuille. `reassignMapping` maintient le 1-à-1 (le fichier choisi est
  // retiré de la piste où il était éventuellement déjà posé).
  const assignLocal = useCallback(
    (local: LocalTrack | null) => {
      setMapping((prev) =>
        prev && pickerFor !== null ? reassignMapping(prev, pickerFor, local) : prev
      );
      setPickerFor(null);
    },
    [pickerFor]
  );

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

  const positionLabel = useCallback(
    (m: ReleaseMapping) =>
      multiDisc ? `${m.release.discNo}-${m.release.position}` : m.release.position,
    [multiDisc]
  );

  // Fichier local → index de la piste de release à laquelle il est associé (pour signaler, dans la
  // feuille de choix, qu'un fichier est déjà pris ailleurs).
  const localAssignment = useMemo(() => {
    const map = new Map<string, number>();
    mapping?.forEach((m, i) => {
      if (m.local) {
        map.set(m.local.id, i);
      }
    });
    return map;
  }, [mapping]);

  const pickerRelease = pickerFor !== null && mapping ? mapping[pickerFor] : null;

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
          {release ? 'Valider' : singleTrack ? 'Rattacher à un album' : 'Identifier l’album'}
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
              {headerTitle}
            </Text>
            <Text style={styles.albumMeta} numberOfLines={1}>
              {singleTrack
                ? headerArtist
                : `${headerArtist} · ${albumTracks.length} ${albumTracks.length > 1 ? 'titres' : 'titre'}`}
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

              <Text style={styles.mapHint}>Touche une ligne pour corriger le fichier associé.</Text>
              <View style={styles.list}>
                {mapping.map((m, i) => (
                  <Pressable
                    key={`${m.release.discNo}-${m.release.position}-${i}`}
                    onPress={() => setPickerFor(i)}
                    style={({ pressed }) => [styles.mapRow, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Corriger le fichier de ${m.release.title}`}
                  >
                    <Text style={styles.posLabel}>{positionLabel(m)}</Text>
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
                    <Icon name="edit" size={18} color={colors.textMuted} />
                  </Pressable>
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

      {/* Feuille de correction manuelle : choisir quel fichier local correspond à cette piste. */}
      <BottomSheet visible={pickerFor !== null} onClose={() => setPickerFor(null)}>
        <Text style={styles.sheetHeader} numberOfLines={2}>
          {pickerRelease ? pickerRelease.release.title : 'Associer un fichier'}
        </Text>

        <Pressable
          onPress={() => assignLocal(null)}
          style={({ pressed }) => [styles.sheetRow, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel="Aucun fichier local"
        >
          <Icon
            name={pickerRelease && !pickerRelease.local ? 'check' : 'block'}
            size={20}
            color={pickerRelease && !pickerRelease.local ? colors.accentIcon : colors.textMuted}
          />
          <Text style={styles.sheetRowLabel}>Aucun (piste manquante)</Text>
        </Pressable>

        <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
          {albumTracks.map((lt) => {
            const assignedIdx = localAssignment.get(lt.id);
            const isCurrent = assignedIdx === pickerFor;
            const elsewhere =
              assignedIdx !== undefined && assignedIdx !== pickerFor && mapping
                ? positionLabel(mapping[assignedIdx])
                : null;
            return (
              <Pressable
                key={lt.id}
                onPress={() => assignLocal(lt)}
                style={({ pressed }) => [styles.sheetRow, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityLabel={`Associer ${lt.title}`}
              >
                <Icon
                  name={isCurrent ? 'check' : 'music_note'}
                  size={20}
                  color={isCurrent ? colors.accentIcon : colors.textSecondary}
                />
                <View style={styles.sheetRowText}>
                  <Text style={styles.sheetRowLabel} numberOfLines={1}>
                    {lt.title}
                  </Text>
                  <Text style={styles.sheetRowHint} numberOfLines={1}>
                    {lt.filename}
                  </Text>
                </View>
                {elsewhere != null && (
                  <Text style={styles.sheetTaken} numberOfLines={1}>
                    Piste {elsewhere}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

function trackCountLabel(count: number | null): string | null {
  return count != null ? `${count} titres` : null;
}

/**
 * Album à pré-remplir pour le rattachement d'un titre seul : le tag album du fichier s'il paraît
 * fiable, sinon rien. Un tag absent, ou égal au titre (le cas faux courant « album = titre
 * répété »), ne doit pas amorcer la recherche release sur une mauvaise piste.
 */
function guessAlbumInput(track: LocalTrack | null): string {
  const album = track?.album?.trim();
  if (!album) {
    return '';
  }
  return normalizeForSearch(album) === normalizeForSearch(track?.title ?? '') ? '' : album;
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
  mapHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  sheetHeader: {
    ...typography.heading,
    fontSize: 15,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  sheetList: {
    // Borne la hauteur : au-delà, la liste des fichiers défile dans la feuille.
    maxHeight: 360,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.sm,
  },
  sheetRowText: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowLabel: {
    ...typography.heading,
    fontSize: 15,
  },
  sheetRowHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  sheetTaken: {
    ...typography.label,
    fontSize: 10,
    color: colors.textMuted,
  },
});
