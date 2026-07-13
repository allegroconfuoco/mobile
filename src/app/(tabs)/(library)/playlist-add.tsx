/**
 * « Ajouter des titres » à une playlist, depuis la playlist elle-même (param `id`).
 *
 * Avant cet écran, l'ajout ne se faisait que depuis la bibliothèque (long-press → picker), piste
 * par piste. Ici : recherche + multi-sélection sur toute la bibliothèque (motif repris de
 * `bulk-set-artist`), ajout en un coup via `addTracksToPlaylist` (déjà batch : registre, dédup,
 * résurrection de tombstones). Écran (pas une feuille basse) : la recherche + le clavier + une
 * liste virtualisée + un CTA de pied de page ne tiennent pas dans une sheet.
 *
 * Les titres déjà dans la playlist restent listés mais grisés et non cochables (repère visuel) —
 * la dédup en base rend ce garde purement présentationnel.
 */
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from '@/lib/useRouter';

import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { SearchBar } from '@/components/SearchBar';
import { showToast } from '@/components/Toast';
import { TrackCover } from '@/components/TrackCover';
import { tapLight } from '@/lib/haptics';
import { artistOf, filterTracks, sortTracks } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import { colors, fontFamily, radii, spacing, typography } from '@/theme';

export default function PlaylistAddScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? '';

  const { tracks } = useLibrary();
  const { playlists, revision, getEntries, addTracksToPlaylist } = usePlaylistsContext();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const playlistName = playlists.find((p) => p.id === id)?.name ?? 'Playlist';

  // Ids media-store des titres déjà dans la playlist : lignes grisées, non cochables.
  const present = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of getEntries(id)) {
      if (entry.localTrackId !== null) {
        ids.add(entry.localTrackId);
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, getEntries, revision]);

  // Bibliothèque triée par titre puis filtrée (ordre stable pour parcourir/cocher).
  const sorted = useMemo(() => sortTracks(tracks, 'title'), [tracks]);
  const visible = useMemo(() => filterTracks(sorted, query), [sorted, query]);

  // « Tout sélectionner » ne porte que sur les lignes visibles encore ajoutables.
  const selectable = useMemo(() => visible.filter((t) => !present.has(t.id)), [visible, present]);
  const allVisibleSelected = selectable.length > 0 && selectable.every((t) => selected.has(t.id));

  const toggle = (trackId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const t of selectable) {
          next.delete(t.id);
        }
      } else {
        for (const t of selectable) {
          next.add(t.id);
        }
      }
      return next;
    });

  const add = () => {
    if (selected.size === 0) {
      return;
    }
    addTracksToPlaylist(id, [...selected]);
    tapLight();
    showToast(
      selected.size > 1
        ? `${selected.size} titres ajoutés à « ${playlistName} »`
        : `Ajouté à « ${playlistName} »`,
      'playlist_add_check'
    );
    router.back();
  };

  const buttonLabel = `Ajouter ${selected.size} titre${selected.size > 1 ? 's' : ''}`;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            Ajouter des titres
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {selected.size > 0 ? `${selected.size} sélectionné(s)` : playlistName}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SearchBar value={query} onChangeText={setQuery} placeholder="Rechercher un titre" />

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
            contentContainerStyle={styles.listContent}
            windowSize={7}
            initialNumToRender={12}
            maxToRenderPerBatch={16}
            ListHeaderComponent={
              selectable.length > 0 ? (
                <Pressable
                  onPress={toggleAllVisible}
                  style={({ pressed }) => [styles.selectAll, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.selectAllLabel}>
                    {allVisibleSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </Text>
                </Pressable>
              ) : null
            }
            ListEmptyComponent={<Text style={styles.empty}>Aucun résultat pour « {query} ».</Text>}
            renderItem={({ item }) => {
              const already = present.has(item.id);
              const on = selected.has(item.id);
              return (
                <Pressable
                  onPress={already ? undefined : () => toggle(item.id)}
                  disabled={already}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                    already && styles.rowPresent,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: already || on, disabled: already }}
                  accessibilityLabel={already ? `${item.title}, déjà dans la playlist` : item.title}
                >
                  {already ? (
                    <Icon name="check_circle" size={24} color={colors.textMuted} />
                  ) : (
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>
                      {on && <Icon name="check" size={16} color={colors.onAccent} />}
                    </View>
                  )}
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
                      {already ? `${artistOf(item)} · déjà dans la playlist` : artistOf(item)}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            onPress={add}
            disabled={selected.size === 0}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              selected.size === 0 && styles.buttonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
          >
            <Icon name="playlist_add_check" size={20} color={colors.onAccent} />
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
    paddingTop: spacing.sm,
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
  rowPresent: {
    opacity: 0.45,
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
