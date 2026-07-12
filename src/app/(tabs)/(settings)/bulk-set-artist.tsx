/**
 * Édition en lot — **associer un artiste** à une sélection de titres (grave le tag artiste dans les
 * fichiers). Cas d'usage : plusieurs titres du même artiste mal/non taggés, qu'on veut corriger d'un
 * coup sans les faire un par un.
 *
 * Décisions actées avec l'utilisateur :
 *  - l'artiste saisi **remplace** entièrement l'artiste existant des titres sélectionnés ;
 *  - on **grave dans les fichiers** (write-back ID3, `graveMany`), pas un overlay réversible.
 *
 * Après gravure, on purge un éventuel override d'artiste (`track_enrichment.artist_override`, posé
 * par l'outil de suppression d'artiste) sur les pistes écrites : sinon `loadTracks` ferait primer
 * l'override sur le tag fraîchement gravé et le changement ne se verrait pas.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { MaskBar } from '@/components/MaskBar';
import { showToast } from '@/components/Toast';
import { SearchBar } from '@/components/SearchBar';
import { TrackCover } from '@/components/TrackCover';
import { useLibrary } from '@/library/LibraryProvider';
import * as db from '@/library/db';
import { artistOf, filterTracks, sortTracks } from '@/library/grouping';
import { isMasked, loadMaskedArtists, maskSet, saveMaskedArtists } from '@/library/rewriteMasks';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { alertPermissionNeeded, graveMany, type WriteSpec } from '@/library/writeTags';
import { colors, fontFamily, radii, spacing, typography } from '@/theme';

export default function BulkSetArtistScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracks, tracksById, reloadTracks } = useLibrary();

  const [artist, setArtist] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState(0);

  // Artistes masqués (« validés », cf. `rewriteMasks`) : leurs titres sont cachés de la liste pour
  // ne pas re-vérifier les mêmes lignes à chaque passe. Persisté, partagé entre écrans.
  const [masks, setMasks] = useState<string[]>(loadMaskedArtists);
  const [showMasked, setShowMasked] = useState(false);
  const maskLookup = useMemo(() => maskSet(masks), [masks]);

  // Liste triée par titre puis filtrée par la recherche (ordre stable pour parcourir/cocher).
  const sorted = useMemo(() => sortTracks(tracks, 'title'), [tracks]);
  const matching = useMemo(() => filterTracks(sorted, query), [sorted, query]);
  const maskedCount = useMemo(
    () => matching.filter((t) => isMasked(maskLookup, artistOf(t))).length,
    [matching, maskLookup]
  );
  const visible = useMemo(
    () => (showMasked ? matching : matching.filter((t) => !isMasked(maskLookup, artistOf(t)))),
    [matching, maskLookup, showMasked]
  );

  const addMask = (name: string) => {
    if (isMasked(maskLookup, name)) {
      return;
    }
    const next = [...masks, name];
    setMasks(next);
    saveMaskedArtists(next);
    // Les pistes qui viennent d'être cachées sortent de la sélection : on ne grave pas l'invisible.
    const lookup = maskSet(next);
    setSelected((prev) => {
      const kept = new Set<string>();
      for (const id of prev) {
        const t = tracksById.get(id);
        if (t && !isMasked(lookup, artistOf(t))) {
          kept.add(id);
        }
      }
      return kept;
    });
    showToast(`« ${name} » masqué des réécritures`, 'visibility_off');
  };

  const removeMask = (name: string) => {
    const next = masks.filter((m) => m !== name);
    setMasks(next);
    saveMaskedArtists(next);
  };

  const confirmMask = (name: string) => {
    Alert.alert(
      'Masquer cet artiste ?',
      `Les titres de « ${name} » seront cachés des écrans de réécriture (associer un artiste, nettoyer les titres). Réversible d’un tap sur la puce.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Masquer', onPress: () => addMask(name) },
      ]
    );
  };

  // Toutes les pistes visibles sont-elles sélectionnées ? (pilote « Tout / Aucun »).
  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const t of visible) {
          next.delete(t.id);
        }
      } else {
        for (const t of visible) {
          next.add(t.id);
        }
      }
      return next;
    });

  const name = artist.trim();
  const canApply = name.length > 0 && selected.size > 0 && !writing;

  const run = async () => {
    const items: { track: LocalTrack; spec: WriteSpec }[] = [];
    for (const id of selected) {
      const track = tracksById.get(id);
      if (track) {
        items.push({
          track,
          spec: {
            tags: {
              title: track.title,
              artist: name,
              album: track.album,
              albumArtist: track.albumArtist,
              trackNo: track.trackNo,
              discNo: track.discNo,
            },
            cover: 'keep',
          },
        });
      }
    }
    if (items.length === 0) {
      return;
    }

    setWriting(true);
    setProgress(0);
    const outcome = await graveMany(items, setProgress);
    // Le tag est gravé : un override d'artiste antérieur masquerait la nouvelle valeur → on le retire.
    for (const id of outcome.writtenIds) {
      db.clearArtistOverride(id);
    }
    setWriting(false);
    reloadTracks();

    if (outcome.permission) {
      alertPermissionNeeded('Relance ensuite l’association.');
      return;
    }
    if (outcome.failed === 0 && outcome.written > 0) {
      setSelected(new Set());
      showToast(
        `« ${name} » écrit dans ${outcome.written} titre${outcome.written > 1 ? 's' : ''}`,
        'person_add'
      );
      router.back();
    } else if (outcome.written === 0) {
      Alert.alert('Échec', 'Aucun titre n’a pu être modifié.');
    } else {
      Alert.alert(
        'Modification partielle',
        `${outcome.written} réussi(s), ${outcome.failed} en échec.`
      );
    }
  };

  const buttonLabel = writing
    ? `Écriture… ${progress}/${selected.size}`
    : `Appliquer à ${selected.size} titre${selected.size > 1 ? 's' : ''}`;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            Associer un artiste
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {selected.size > 0 ? `${selected.size} sélectionné(s)` : 'Sélectionne des titres'}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Artiste</Text>
          <TextInput
            value={artist}
            onChangeText={setArtist}
            placeholder="Nom de l’artiste"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            selectionColor={colors.accent}
            autoCorrect={false}
          />
        </View>

        <SearchBar value={query} onChangeText={setQuery} placeholder="Filtrer les titres" />

        <MaskBar
          masks={masks}
          maskedCount={maskedCount}
          showMasked={showMasked}
          onToggleShow={() => setShowMasked((v) => !v)}
          onRemove={removeMask}
        />

        {sorted.length === 0 ? (
          <View style={styles.centered}>
            <Icon name="music_off" size={40} color={colors.textMuted} />
            <Text style={styles.stateText}>Aucun titre dans la bibliothèque.</Text>
          </View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(t) => t.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            windowSize={7}
            initialNumToRender={12}
            maxToRenderPerBatch={16}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <View>
                <Pressable
                  onPress={toggleAllVisible}
                  style={({ pressed }) => [styles.selectAll, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.selectAllLabel}>
                    {allVisibleSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </Text>
                </Pressable>
                <Text style={styles.maskHint}>
                  Appui long sur un titre pour masquer son artiste (validé) des réécritures.
                </Text>
              </View>
            }
            ListEmptyComponent={<Text style={styles.empty}>Aucun résultat pour « {query} ».</Text>}
            renderItem={({ item }) => {
              const on = selected.has(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  onLongPress={() => confirmMask(artistOf(item))}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={item.title}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on && <Icon name="check" size={16} color={colors.onAccent} />}
                  </View>
                  <TrackCover
                    uri={item.artworkUri ?? item.coverArtUrl}
                    size={40}
                    seed={`${item.title}${item.artist ?? ''}`}
                  />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.rowArtist} numberOfLines={1}>
                      {artistOf(item)}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            onPress={() => void run()}
            disabled={!canApply}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              !canApply && styles.buttonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
          >
            {writing ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Icon name="person_add" size={20} color={colors.onAccent} />
            )}
            <Text style={styles.primaryLabel}>{buttonLabel}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
    marginBottom: spacing.md,
  },
  headerText: { flex: 1 },
  title: typography.title,
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    ...typography.label,
    fontSize: 10,
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
    gap: spacing.xs,
  },
  selectAll: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  selectAllLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    color: colors.accentLabel,
  },
  maskHint: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    color: colors.textMuted,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  empty: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.textMuted,
    paddingVertical: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: fontFamily.semibold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowArtist: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
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
  buttonDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
