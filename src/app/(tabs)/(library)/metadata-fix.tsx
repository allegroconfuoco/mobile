import { useCallback, useEffect, useRef, useState } from 'react';
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
import { searchMetadata, type ResolvedMetadata } from '@/library/musicbrainzApi';
import { buildMatchQuery } from '@/library/matchQuery';

/**
 * UI de correction manuelle des métadonnées (issue #20).
 *
 * Aucune auto-résolution MusicBrainz (issue #19) n'est fiable à 100% : cet écran laisse
 * l'utilisateur **valider** le match proposé, ou **chercher un autre** candidat et le retenir.
 * Le choix est persisté dans `track_enrichment` avec le statut `confirmed` (signal humain le plus
 * fort ; l'auto-runner ne rejoue jamais une piste déjà enrichie).
 *
 * Poussé depuis le menu long-press d'une piste (`TrackActionsSheet`), avec `trackId` en paramètre.
 */
export default function MetadataFixScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    trackId,
    artist: artistParam,
    title: titleParam,
  } = useLocalSearchParams<{ trackId: string; artist?: string; title?: string }>();
  const { tracksById, reloadTracks } = useLibrary();
  const { getAccessToken } = useAuth();

  const track = trackId ? tracksById.get(trackId) : undefined;

  // Enrichissement courant lu une fois (source du « match proposé »). Peut être null (jamais tenté).
  const [enrichment] = useState<db.EnrichmentRow | null>(() =>
    trackId ? db.loadEnrichment(trackId) : null
  );
  const hasProposal = enrichment?.mbid != null;

  // Préremplissage des champs de recherche. Priorité aux params `artist`/`title` fournis par
  // l'appelant (ex. le rangement d'« Album inconnu » passe une requête déjà nettoyée agressivement) ;
  // sinon on nettoie via le **même** parser que l'auto-match (`buildMatchQuery`, #18) plutôt que de
  // recopier le tag/nom de fichier brut (préfixe artiste, `(Official Video)`, `[2019]`, feat.,
  // remaster, n° de piste…) — sinon la recherche repart avec un titre pollué et ne trouve rien.
  const cleaned = track
    ? buildMatchQuery({ title: track.title, artist: track.artist, filename: track.filename })
    : null;
  const [artistInput, setArtistInput] = useState(
    artistParam || cleaned?.artist || track?.artist || ''
  );
  const [titleInput, setTitleInput] = useState(titleParam || cleaned?.title || track?.title || '');
  // On révèle la recherche d'emblée quand il n'y a pas de match à valider.
  const [showSearch, setShowSearch] = useState(!hasProposal);
  const [results, setResults] = useState<ResolvedMetadata[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    if (!artistInput.trim() && !titleInput.trim()) {
      setSearchError('Renseigne au moins un artiste ou un titre.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setSearchError('Session expirée : reconnecte-toi pour rechercher.');
        return;
      }
      const found = await searchMetadata(token, { artist: artistInput, title: titleInput });
      setResults(found);
    } catch (e) {
      setSearchError(
        e instanceof ApiError ? e.message : 'La recherche a échoué. Réessaie plus tard.'
      );
    } finally {
      setSearching(false);
    }
  }, [artistInput, titleInput, getAccessToken]);

  // Première recherche automatique quand aucun match n'est proposé (l'écran s'ouvre déjà
  // « en mode recherche ») : évite un tap de plus pour la correction la plus fréquente.
  const autoSearched = useRef(false);
  useEffect(() => {
    if (!hasProposal && !autoSearched.current && track) {
      autoSearched.current = true;
      void runSearch();
    }
  }, [hasProposal, runSearch, track]);

  // Persiste un choix (validation ou correction) : statut `confirmed`, puis relit la biblio pour
  // refléter album/pochette et referme l'écran.
  const confirm = useCallback(
    (data: db.EnrichmentData) => {
      if (!trackId) {
        return;
      }
      db.saveEnrichment(trackId, 'confirmed', data, Date.now());
      reloadTracks();
      router.back();
    },
    [trackId, reloadTracks, router]
  );

  const validateProposal = useCallback(() => {
    if (!enrichment) {
      return;
    }
    confirm({
      mbid: enrichment.mbid,
      title: enrichment.title,
      artist: enrichment.artist,
      album: enrichment.album,
      coverArtUrl: enrichment.coverArtUrl,
      releaseGroupMbid: enrichment.releaseGroupMbid,
    });
  }, [enrichment, confirm]);

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
        <Text style={styles.title}>Corriger les infos</Text>
      </View>

      {!track ? (
        <View style={styles.centered}>
          <Icon name="music_note" size={40} color={colors.textMuted} />
          <Text style={styles.stateText}>Piste introuvable.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Ce qu'on a en local. */}
            <Text style={styles.sectionLabel}>Fichier local</Text>
            <View style={styles.localCard}>
              <TrackCover uri={track.artworkUri ?? track.coverArtUrl} size={56} />
              <View style={styles.localText}>
                <Text style={styles.localTitle} numberOfLines={2}>
                  {track.title}
                </Text>
                <Text style={styles.localMeta} numberOfLines={1}>
                  {track.artist ?? 'Artiste inconnu'}
                </Text>
                <Text style={styles.localFile} numberOfLines={1}>
                  {track.filename}
                </Text>
              </View>
            </View>

            {/* Match proposé (auto ou déjà validé). */}
            <Text style={[styles.sectionLabel, styles.sectionSpacer]}>Match MusicBrainz</Text>
            {hasProposal ? (
              <View style={styles.proposalCard}>
                <TrackCover uri={enrichment?.coverArtUrl ?? track.coverArtUrl} size={56} />
                <View style={styles.localText}>
                  <View style={styles.statusRow}>
                    <Icon
                      name={enrichment?.status === 'confirmed' ? 'check_circle' : 'graphic_eq'}
                      size={16}
                      color={colors.accentIcon}
                    />
                    <Text style={styles.statusLabel}>
                      {enrichment?.status === 'confirmed'
                        ? 'Match validé'
                        : 'Match proposé automatiquement'}
                    </Text>
                  </View>
                  <Text style={styles.localMeta} numberOfLines={1}>
                    {enrichment?.album ?? 'Album inconnu'}
                  </Text>
                  <Text style={styles.mbid} numberOfLines={1}>
                    MBID {enrichment?.mbid}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.empty}>{noProposalText(enrichment?.status ?? null)}</Text>
            )}

            {hasProposal && enrichment?.status !== 'confirmed' && (
              <Pressable
                onPress={validateProposal}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
                accessibilityRole="button"
                accessibilityLabel="Valider ce match"
              >
                <Icon name="check" size={20} color={colors.onAccent} />
                <Text style={styles.primaryLabel}>Valider ce match</Text>
              </Pressable>
            )}

            {hasProposal && !showSearch && (
              <Pressable
                onPress={() => setShowSearch(true)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Chercher un autre match"
              >
                <Icon name="search" size={20} color={colors.textPrimary} />
                <Text style={styles.secondaryLabel}>Chercher un autre match</Text>
              </Pressable>
            )}

            {/* Recherche manuelle d'un autre candidat. */}
            {showSearch && (
              <View style={styles.searchSection}>
                <Text style={[styles.sectionLabel, styles.sectionSpacer]}>Chercher un autre</Text>
                <TextInput
                  value={artistInput}
                  onChangeText={setArtistInput}
                  placeholder="Artiste"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  autoCapitalize="words"
                  returnKeyType="search"
                />
                <TextInput
                  value={titleInput}
                  onChangeText={setTitleInput}
                  placeholder="Titre"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={() => void runSearch()}
                />
                <Pressable
                  onPress={() => void runSearch()}
                  disabled={searching}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.secondaryPressed,
                    searching && styles.buttonDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Rechercher"
                >
                  <Icon name="search" size={20} color={colors.textPrimary} />
                  <Text style={styles.secondaryLabel}>Rechercher</Text>
                </Pressable>

                {searching && (
                  <View style={styles.searchState}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.stateText}>Recherche…</Text>
                  </View>
                )}
                {searchError && !searching && <Text style={styles.error}>{searchError}</Text>}
                {results && !searching && results.length === 0 && (
                  <Text style={styles.empty}>Aucun résultat. Ajuste l’artiste ou le titre.</Text>
                )}

                {results?.map((r) => (
                  <Pressable
                    key={r.mbid}
                    onPress={() =>
                      confirm({
                        mbid: r.mbid,
                        title: r.title,
                        artist: r.artist,
                        album: r.album,
                        coverArtUrl: r.coverArtUrl,
                        releaseGroupMbid: r.releaseGroupMbid,
                      })
                    }
                    style={({ pressed }) => [styles.resultRow, pressed && styles.rowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Retenir ${r.title}${r.artist ? `, ${r.artist}` : ''}`}
                  >
                    <TrackCover uri={r.coverArtUrl} size={48} fallbackIcon="album" />
                    <View style={styles.resultText}>
                      <Text style={styles.resultTitle} numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text style={styles.resultMeta} numberOfLines={1}>
                        {[r.artist, r.album].filter(Boolean).join(' · ') || 'Artiste inconnu'}
                      </Text>
                    </View>
                    <Icon name="chevron_right" size={22} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

/** Libellé quand aucun match n'est proposé, selon la raison. */
function noProposalText(status: db.EnrichmentStatus | null): string {
  switch (status) {
    case 'nomatch':
      return 'Aucun match trouvé automatiquement. Cherche le bon morceau ci-dessous.';
    case 'skipped':
      return 'Non recherché (infos insuffisantes). Renseigne artiste et titre pour chercher.';
    default:
      return 'Pas encore analysé. Cherche le bon morceau ci-dessous.';
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  stateText: {
    ...typography.body,
    textAlign: 'center',
  },
  sectionLabel: {
    ...typography.label,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  sectionSpacer: {
    marginTop: spacing.xxl,
  },
  localCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xxl,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  proposalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xxl,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  localText: {
    flex: 1,
    minWidth: 0,
  },
  localTitle: {
    ...typography.heading,
  },
  localMeta: {
    ...typography.body,
    fontSize: 12,
    marginTop: 2,
  },
  localFile: {
    ...typography.body,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.accentLabel,
  },
  mbid: {
    ...typography.body,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  empty: {
    ...typography.body,
    paddingHorizontal: spacing.xxl,
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
  buttonDisabled: {
    opacity: 0.5,
  },
  secondaryLabel: {
    ...typography.heading,
    fontSize: 14,
  },
  searchSection: {
    marginTop: spacing.xs,
  },
  input: {
    ...typography.heading,
    fontSize: 15,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
  },
  searchState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  error: {
    ...typography.body,
    color: colors.accent,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  resultText: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    ...typography.heading,
  },
  resultMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
