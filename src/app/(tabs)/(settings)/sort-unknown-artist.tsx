import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from '@/lib/useRouter';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { TrackCover } from '@/components/TrackCover';
import { showToast } from '@/components/Toast';
import { selection, tapLight } from '@/lib/haptics';
import { useAuth } from '@/auth/AuthProvider';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import * as db from '@/library/db';
import { ApiError } from '@/api/auth';
import { buildMatchQuery, cleanTitleForSearch } from '@/library/matchQuery';
import { searchMetadata, type ResolvedMetadata } from '@/library/musicbrainzApi';
import { artistOf, UNKNOWN_ARTIST } from '@/library/grouping';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/**
 * Associer les artistes inconnus — revue « une piste à la fois », façon appli de rencontre.
 *
 * Les fichiers dont seul le titre est taggé s'entassent sous « Artiste inconnu » ; les associer un
 * par un via l'écran de correction est trop lent. Ici : la piste locale (écoutable via le player
 * normal — on trie à l'oreille), un deck de propositions MusicBrainz **classées par popularité**
 * (le backend re-classe les recherches titre-seul via Deezer et sème les artistes canoniques
 * absents du pool), swipe gauche = proposition suivante, swipe droite (ou ✓) = associer, « Passer »
 * = titre suivant sans rien écrire. Pensé pour être fait par petites sessions : la file se
 * recalcule à chaque ouverture sur ce qui reste inconnu.
 *
 * Application = overlay réversible, **ordre impératif** : `saveEnrichment('confirmed', match)`
 * (INSERT OR REPLACE : écrase toute la ligne) PUIS `setArtistOverride` (upsert qui préserve le
 * reste) — `loadTracks` affiche `COALESCE(artist_override, t.artist)`, donc sans l'override
 * l'artiste resterait « inconnu », et dans l'ordre inverse le REPLACE effacerait l'override.
 * La gravure ID3 reste une action séparée (« Écrire dans les fichiers »).
 *
 * Avancement : une seule voie — l'effet qui observe la biblio. Valider écrit puis `reloadTracks()`,
 * la piste courante cesse d'être « inconnue » et l'effet passe à la suivante ; un détour par
 * `/metadata-fix` qui corrige la piste avance pareil au retour. « Passer » avance manuellement.
 *
 * Rate limit (~1 req/s via le proxy) : une recherche par piste, sérialisée, avec **prefetch de la
 * piste suivante** pendant que l'utilisateur regarde la courante — la latence disparaît du flux.
 * Gestes en `Animated` + `PanResponder` cœur RN (reanimated/gesture-handler non configurés).
 */

type Deck = {
  status: 'loading' | 'ready' | 'error';
  matches: ResolvedMetadata[];
  cursor: number;
};

/**
 * Termes de recherche d'une piste sans artiste : le parser conservateur peut extraire un artiste
 * embarqué (« Artiste - Titre » dans le tag titre ou le nom de fichier) → recherche scopée côté
 * backend ; sinon titre nettoyé seul → classement popularité. Partagé entre la passe auto et le
 * pré-remplissage de `/metadata-fix` (cohérence, cf. le correctif « filtrage incohérent »).
 */
function searchTermsFor(track: LocalTrack): { artist: string | null; title: string } {
  const q = buildMatchQuery({ title: track.title, artist: track.artist, filename: track.filename });
  return {
    artist: q?.artist ?? null,
    title: q?.title ?? cleanTitleForSearch(track.title || track.filename, null),
  };
}

export default function SortUnknownArtistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracks, tracksById, reloadTracks } = useLibrary();
  const { getAccessToken } = useAuth();

  // File de revue figée au montage : elle ne bouge pas sous les doigts pendant la session ;
  // rouvrir l'écran la recalcule sur ce qui reste inconnu (les passés y compris).
  const [queue] = useState<LocalTrack[]>(() =>
    tracks.filter((t) => artistOf(t) === UNKNOWN_ARTIST)
  );
  const [index, setIndex] = useState(0);
  const [decks, setDecks] = useState<Map<string, Deck>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const current = index < queue.length ? queue[index] : null;
  const deck = current ? decks.get(current.id) : undefined;

  // Voie d'avancement unique, en « ajustement d'état pendant le rendu » (motif syncedItems de
  // DraggableTrackList — la règle set-state-in-effect interdit un setState dans un effet) : la
  // piste courante a maintenant un artiste (validée ici via reloadTracks, ou corrigée par un
  // détour /metadata-fix) ou a disparu de la biblio → on ré-affiche aussitôt avec la suivante.
  // Borné : au pire, ré-ajuste jusqu'à la prochaine piste encore inconnue de la file.
  if (current) {
    const fresh = tracksById.get(current.id);
    if (!fresh || artistOf(fresh) !== UNKNOWN_ARTIST) {
      setIndex(index + 1);
    }
  }

  // --- Résolution MusicBrainz, sérialisée (1 req/s en amont) avec prefetch du suivant ---------

  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const decksRef = useRef(decks);
  useEffect(() => {
    decksRef.current = decks;
  }, [decks]);

  const pendingRef = useRef<LocalTrack[]>([]);
  const pumping = useRef(false);

  const setDeck = useCallback((id: string, next: Deck) => {
    setDecks((prev) => {
      const map = new Map(prev);
      map.set(id, next);
      return map;
    });
  }, []);

  const pump = useCallback(async () => {
    if (pumping.current) {
      return;
    }
    pumping.current = true;
    try {
      while (pendingRef.current.length > 0 && !cancelled.current) {
        const track = pendingRef.current.shift();
        if (!track || decksRef.current.get(track.id)?.status === 'ready') {
          continue;
        }
        setDeck(track.id, { status: 'loading', matches: [], cursor: 0 });
        const terms = searchTermsFor(track);
        if (!terms.title) {
          setDeck(track.id, { status: 'ready', matches: [], cursor: 0 });
          continue;
        }
        const token = await getAccessToken();
        if (!token) {
          setError('Session expirée : reconnecte-toi pour lancer la recherche.');
          setDeck(track.id, { status: 'error', matches: [], cursor: 0 });
          return;
        }
        try {
          const results = await searchMetadata(
            token,
            { artist: terms.artist ?? undefined, title: terms.title },
            6
          );
          if (cancelled.current) {
            return;
          }
          // Une proposition sans artiste ne peut rien associer : écartée d'office.
          setDeck(track.id, {
            status: 'ready',
            matches: results.filter((m) => m.artist),
            cursor: 0,
          });
          setError(null);
        } catch (e) {
          if (cancelled.current) {
            return;
          }
          // Réseau / 401 / 503 (throttle) / 5xx : arrêt propre de la passe, la piste en cours
          // passe en erreur (bouton Réessayer), le prefetch reprendra au retry.
          setDeck(track.id, { status: 'error', matches: [], cursor: 0 });
          setError(
            e instanceof ApiError ? e.message : 'La recherche a échoué. Réessaie plus tard.'
          );
          pendingRef.current = [];
          return;
        }
      }
    } finally {
      pumping.current = false;
    }
  }, [getAccessToken, setDeck]);

  const requestDeck = useCallback(
    (track: LocalTrack | null | undefined, force = false) => {
      if (!track) {
        return;
      }
      const existing = decksRef.current.get(track.id);
      if (existing && !(force && existing.status === 'error')) {
        return;
      }
      if (pendingRef.current.some((t) => t.id === track.id)) {
        return;
      }
      pendingRef.current.push(track);
      void pump();
    },
    [pump]
  );

  useEffect(() => {
    requestDeck(current);
    requestDeck(queue[index + 1] ?? null);
  }, [current, index, queue, requestDeck]);

  // --- Actions ---------------------------------------------------------------------------------

  const validate = useCallback(
    (track: LocalTrack, match: ResolvedMetadata) => {
      if (!match.artist) {
        return;
      }
      const now = Date.now();
      db.saveEnrichment(
        track.id,
        'confirmed',
        {
          mbid: match.mbid,
          title: match.title,
          artist: match.artist,
          album: match.album,
          coverArtUrl: match.coverArtUrl,
          releaseGroupMbid: match.releaseGroupMbid,
        },
        now
      );
      db.setArtistOverride(track.id, match.artist, now);
      tapLight();
      showToast(`Associé à ${match.artist}`, 'check');
      // Fait avancer l'écran via l'effet d'avancement (l'artiste n'est plus inconnu).
      reloadTracks();
    },
    [reloadTracks]
  );

  const nextProposition = useCallback(
    (track: LocalTrack) => {
      selection();
      const d = decksRef.current.get(track.id);
      if (d) {
        setDeck(track.id, { ...d, cursor: d.cursor + 1 });
      }
    },
    [setDeck]
  );

  const skip = useCallback(() => {
    selection();
    setIndex((i) => i + 1);
  }, []);

  const searchOther = useCallback(
    (track: LocalTrack) => {
      const terms = searchTermsFor(track);
      router.push({
        pathname: '/metadata-fix',
        params: { trackId: track.id, artist: terms.artist ?? '', title: terms.title },
      });
    },
    [router]
  );

  // --- Rendu -----------------------------------------------------------------------------------

  const remaining = queue.length - index;

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
            Associer les artistes
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {current
              ? `Titre ${index + 1} sur ${queue.length}`
              : queue.length === 0
                ? 'Aucun titre sans artiste'
                : 'Revue terminée'}
          </Text>
        </View>
      </View>

      {current ? (
        <View style={styles.body}>
          <LocalTrackCard track={current} />
          <PropositionArea
            key={current.id}
            track={current}
            deck={deck}
            error={error}
            onAccept={(match) => validate(current, match)}
            onReject={() => nextProposition(current)}
            onRetry={() => requestDeck(current, true)}
            onSearchOther={() => searchOther(current)}
          />
          <Pressable
            onPress={skip}
            android_ripple={{ color: colors.borderStrong }}
            style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Passer ce titre"
          >
            <Icon name="skip_next" size={18} color={colors.textSecondary} />
            <Text style={styles.skipLabel}>Passer ce titre</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.doneWrap}>
          <Icon name="check_circle" size={48} color={colors.accentIcon} />
          <Text style={styles.doneTitle}>
            {queue.length === 0 ? 'Rien à associer' : 'Revue terminée'}
          </Text>
          <Text style={styles.doneText}>
            {queue.length === 0
              ? 'Aucun titre n’est rangé sous « Artiste inconnu ».'
              : 'Les titres passés resteront proposés à la prochaine ouverture.'}
          </Text>
          <Pressable
            onPress={() => router.back()}
            android_ripple={{ color: colors.borderStrong }}
            style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Terminer"
          >
            <Text style={styles.doneButtonLabel}>Terminer</Text>
          </Pressable>
        </View>
      )}

      {remaining > 0 && current && (
        <Text style={[styles.footerHint, { paddingBottom: insets.bottom + spacing.md }]}>
          Swipe à droite pour associer, à gauche pour voir une autre proposition.
        </Text>
      )}
    </View>
  );
}

/**
 * Carte « fichier local » : titre parsé + nom de fichier + lecture via le **player normal**
 * (remplace la file en cours, assumé : on identifie à l'oreille). Composant séparé pour isoler le
 * re-rendu 4 Hz de `usePlayback` (motif MiniProgressBar).
 */
function LocalTrackCard({ track }: { track: LocalTrack }) {
  const { playQueue, togglePlayPause } = usePlayer();
  const { track: active, isPlaying } = usePlayback();
  const isCurrent = active?.mediaId === track.id;

  return (
    <View style={styles.localCard}>
      <TrackCover uri={track.artworkUri} size={52} fallbackIcon="music_note" />
      <View style={styles.localText}>
        <Text style={styles.localTitle} numberOfLines={1}>
          {searchTermsFor(track).title || track.title}
        </Text>
        <Text style={styles.localMeta} numberOfLines={1}>
          {track.filename}
        </Text>
      </View>
      <Pressable
        onPress={() => {
          if (isCurrent) {
            void togglePlayPause();
          } else {
            void playQueue([track], 0, 'library');
          }
        }}
        android_ripple={{ color: colors.borderStrong, radius: 24 }}
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={isCurrent && isPlaying ? 'Mettre en pause' : 'Écouter ce fichier'}
      >
        <Icon
          name={isCurrent && isPlaying ? 'pause' : 'play_arrow'}
          size={26}
          color={colors.onAccent}
        />
      </Pressable>
    </View>
  );
}

/** Zone centrale : deck swipeable, ou les états chargement / erreur / deck épuisé. */
function PropositionArea({
  track,
  deck,
  error,
  onAccept,
  onReject,
  onRetry,
  onSearchOther,
}: {
  track: LocalTrack;
  deck: Deck | undefined;
  error: string | null;
  onAccept: (match: ResolvedMetadata) => void;
  onReject: () => void;
  onRetry: () => void;
  onSearchOther: () => void;
}) {
  if (!deck || deck.status === 'loading') {
    return (
      <View style={styles.deckPlaceholder}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.placeholderText}>Recherche MusicBrainz…</Text>
      </View>
    );
  }

  if (deck.status === 'error') {
    return (
      <View style={styles.deckPlaceholder}>
        <Icon name="cloud_off" size={32} color={colors.textMuted} />
        <Text style={styles.placeholderText}>{error ?? 'La recherche a échoué.'}</Text>
        <Pressable
          onPress={onRetry}
          android_ripple={{ color: colors.borderStrong }}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Réessayer la recherche"
        >
          <Icon name="refresh" size={18} color={colors.textPrimary} />
          <Text style={styles.secondaryLabel}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  const match = deck.matches[deck.cursor] ?? null;
  if (!match) {
    return (
      <View style={styles.deckPlaceholder}>
        <Icon name="music_off" size={32} color={colors.textMuted} />
        <Text style={styles.placeholderText}>
          {deck.matches.length === 0
            ? 'Aucune proposition pour ce titre.'
            : 'Plus d’autre proposition.'}
        </Text>
        <Pressable
          onPress={onSearchOther}
          android_ripple={{ color: colors.borderStrong }}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Chercher autrement"
        >
          <Icon name="search" size={18} color={colors.textPrimary} />
          <Text style={styles.secondaryLabel}>Chercher autrement</Text>
        </Pressable>
      </View>
    );
  }

  const next = deck.matches[deck.cursor + 1] ?? null;

  return (
    <View style={styles.deckWrap}>
      <View style={styles.cardStack}>
        {next && (
          <View style={[styles.card, styles.cardUnder]} pointerEvents="none">
            <TrackCover uri={next.coverArtUrl} size={132} fallbackIcon="album" />
          </View>
        )}
        <SwipeCard
          // Nouvelle carte (état de geste vierge) à chaque proposition.
          key={`${track.id}:${deck.cursor}`}
          match={match}
          position={deck.cursor + 1}
          total={deck.matches.length}
          onAccept={() => onAccept(match)}
          onReject={onReject}
        />
      </View>
      <View style={styles.actionsRow}>
        <Pressable
          onPress={onReject}
          android_ripple={{ color: colors.borderStrong, radius: 28 }}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Proposition suivante"
        >
          <Icon name="close" size={26} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={onSearchOther}
          android_ripple={{ color: colors.borderStrong, radius: 28 }}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Chercher autrement"
        >
          <Icon name="search" size={22} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={() => onAccept(match)}
          android_ripple={{ color: colors.borderStrong, radius: 28 }}
          style={({ pressed }) => [
            styles.roundButton,
            styles.acceptButton,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Associer à ${match.artist ?? ''}`}
        >
          <Icon name="check" size={28} color={colors.onAccent} />
        </Pressable>
      </View>
    </View>
  );
}

/** La carte de proposition swipeable : droite = associer, gauche = suivante. */
function SwipeCard({
  match,
  position,
  total,
  onAccept,
  onReject,
}: {
  match: ResolvedMetadata;
  position: number;
  total: number;
  onAccept: () => void;
  onReject: () => void;
}) {
  // Animated.Value via useState (règle react-hooks/refs, motif du projet).
  const [panX] = useState(() => new Animated.Value(0));

  // Closures fraîches sans recréer le responder (motif actionsRef du mini-player).
  const actionsRef = useRef({ onAccept, onReject });
  useEffect(() => {
    actionsRef.current = { onAccept, onReject };
  });

  const flyOut = useCallback(
    (direction: 1 | -1, done: () => void) => {
      Animated.timing(panX, {
        toValue: direction * 480,
        duration: 160,
        useNativeDriver: true,
      }).start(() => done());
    },
    [panX]
  );

  // `actionsRef` n'est lue que dans les handlers de geste (jamais pendant le rendu) : motif
  // standard PanResponder, où la règle react-hooks/refs donne un faux positif sur useMemo.
  /* eslint-disable react-hooks/refs */
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Ne capte qu'un vrai geste horizontal : préserve le scroll vertical et les taps.
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: (_e, g) => panX.setValue(g.dx),
        onPanResponderRelease: (_e, g) => {
          if (g.dx > 80 || g.vx > 0.8) {
            flyOut(1, () => actionsRef.current.onAccept());
          } else if (g.dx < -80 || g.vx < -0.8) {
            flyOut(-1, () => actionsRef.current.onReject());
          } else {
            Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [panX, flyOut]
  );
  /* eslint-enable react-hooks/refs */

  const rotate = panX.interpolate({
    inputRange: [-240, 0, 240],
    outputRange: ['-7deg', '0deg', '7deg'],
  });
  const acceptOpacity = panX.interpolate({
    inputRange: [0, 90],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const rejectOpacity = panX.interpolate({
    inputRange: [-90, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[styles.card, { transform: [{ translateX: panX }, { rotate }] }]}
    >
      <Text style={styles.cardCount}>
        Proposition {position}/{total}
      </Text>
      <TrackCover uri={match.coverArtUrl} size={132} fallbackIcon="album" />
      <Text style={styles.cardArtist} numberOfLines={2}>
        {match.artist}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={2}>
        {match.title}
        {match.album ? ` · ${match.album}` : ''}
      </Text>
      <Animated.View style={[styles.swipeBadge, styles.swipeAccept, { opacity: acceptOpacity }]}>
        <Icon name="check" size={30} color={colors.onAccent} />
      </Animated.View>
      <Animated.View style={[styles.swipeBadge, styles.swipeReject, { opacity: rejectOpacity }]}>
        <Icon name="close" size={30} color={colors.textPrimary} />
      </Animated.View>
    </Animated.View>
  );
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
  body: {
    flex: 1,
    paddingHorizontal: spacing.xxl,
    gap: spacing.lg,
  },
  localCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
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
    color: colors.textMuted,
    marginTop: 2,
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.85,
  },
  deckWrap: {
    flex: 1,
    gap: spacing.lg,
  },
  cardStack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '92%',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  cardUnder: {
    position: 'absolute',
    transform: [{ scale: 0.94 }, { translateY: 10 }],
    opacity: 0.5,
  },
  cardCount: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  cardArtist: {
    ...typography.title,
    fontSize: 22,
    textAlign: 'center',
  },
  cardMeta: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  swipeBadge: {
    position: 'absolute',
    top: spacing.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeAccept: {
    left: spacing.lg,
    backgroundColor: colors.accent,
  },
  swipeReject: {
    right: spacing.lg,
    backgroundColor: colors.borderStrong,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  roundButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  acceptButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  deckPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  placeholderText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  secondaryLabel: {
    ...typography.heading,
    fontSize: 14,
  },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  skipLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  doneWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  doneTitle: {
    ...typography.title,
  },
  doneText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  doneButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  doneButtonLabel: {
    ...typography.heading,
    fontSize: 14,
    color: colors.onAccent,
  },
  footerHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.sm,
  },
});
