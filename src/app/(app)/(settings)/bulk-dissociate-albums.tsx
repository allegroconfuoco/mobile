/**
 * Édition en lot — **dissocier des albums** : retirer plusieurs albums d'un coup en vidant le tag
 * album (et album-artist) des fichiers concernés. Cas d'usage : des titres téléchargés regroupés à
 * tort sous un « album » bidon (nom de playlist, libellé du site…) qu'on veut voir comme des
 * morceaux isolés.
 *
 * Décision actée avec l'utilisateur : on **grave dans les fichiers** (write-back ID3), pas un overlay.
 * Mais graver un album vide ne suffit pas : `loadTracks` ferait ressusciter l'album via l'overlay
 * release (#23) ou l'album de l'auto-match (#19). Après gravure on appelle donc
 * `db.dissociateAlbumTracks` qui neutralise ces deux sources → le titre retombe sur « Album inconnu »
 * (regroupé par artiste). Réversible par la restauration des tags d'origine (gravure).
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import { tapMedium } from '@/lib/haptics';
import { SearchBar } from '@/components/SearchBar';
import { TrackCover } from '@/components/TrackCover';
import { useLibrary } from '@/library/LibraryProvider';
import * as db from '@/library/db';
import { buildAlbums, filterAlbums, tracksForAlbum } from '@/library/grouping';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { alertPermissionNeeded, graveMany, type WriteSpec } from '@/library/writeTags';
import { colors, fontFamily, radii, spacing, typography } from '@/theme';

export default function BulkDissociateAlbumsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tracks, reloadTracks } = useLibrary();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState(0);

  const albums = useMemo(() => buildAlbums(tracks), [tracks]);
  const visible = useMemo(() => filterAlbums(albums, query), [albums, query]);

  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.key));

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const a of visible) {
          next.delete(a.key);
        }
      } else {
        for (const a of visible) {
          next.add(a.key);
        }
      }
      return next;
    });

  // Toutes les pistes des albums sélectionnés (résolues au moment de l'action).
  const selectedTracks = (): LocalTrack[] =>
    [...selected].flatMap((key) => tracksForAlbum(tracks, key));

  const run = async () => {
    const targets = selectedTracks();
    const items: { track: LocalTrack; spec: WriteSpec }[] = targets.map((track) => ({
      track,
      spec: {
        tags: {
          title: track.title,
          artist: track.artist,
          album: null,
          albumArtist: null,
          trackNo: track.trackNo,
          discNo: track.discNo,
        },
        cover: 'keep',
      },
    }));
    if (items.length === 0) {
      return;
    }

    setWriting(true);
    setProgress(0);
    const outcome = await graveMany(items, setProgress);
    // Neutralise les overlays (release / auto-match) des pistes gravées, sinon l'album ressusciterait.
    db.dissociateAlbumTracks(outcome.writtenIds);
    setWriting(false);
    reloadTracks();

    if (outcome.permission) {
      alertPermissionNeeded('Relance ensuite la dissociation.');
      return;
    }
    if (outcome.failed === 0 && outcome.written > 0) {
      setSelected(new Set());
      showToast(
        `${outcome.written} titre${outcome.written > 1 ? 's' : ''} dissocié${outcome.written > 1 ? 's' : ''} de leur album`,
        'link_off'
      );
      router.back();
    } else if (outcome.written === 0) {
      Alert.alert('Échec', 'Aucun titre n’a pu être modifié.');
    } else {
      Alert.alert(
        'Dissociation partielle',
        `${outcome.written} réussi(s), ${outcome.failed} en échec.`
      );
    }
  };

  const confirmRun = () => {
    const trackCount = selectedTracks().length;
    Alert.alert(
      'Dissocier ces albums ?',
      `Le tag album sera vidé dans ${trackCount} fichier${trackCount > 1 ? 's' : ''}. Réversible via la restauration des tags.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Dissocier',
          style: 'destructive',
          onPress: () => {
            tapMedium();
            void run();
          },
        },
      ]
    );
  };

  const buttonLabel = writing
    ? `Dissociation… ${progress}`
    : `Dissocier ${selected.size} album${selected.size > 1 ? 's' : ''}`;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            Dissocier des albums
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {selected.size > 0 ? `${selected.size} sélectionné(s)` : 'Sélectionne des albums'}
          </Text>
        </View>
      </View>

      <SearchBar value={query} onChangeText={setQuery} placeholder="Filtrer les albums" />

      {albums.length === 0 ? (
        <View style={styles.centered}>
          <Icon name="album" size={40} color={colors.textMuted} />
          <Text style={styles.stateText}>Aucun album dans la bibliothèque.</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(a) => a.key}
          keyboardShouldPersistTaps="handled"
          windowSize={7}
          initialNumToRender={12}
          maxToRenderPerBatch={16}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Pressable
              onPress={toggleAllVisible}
              style={({ pressed }) => [styles.selectAll, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.selectAllLabel}>
                {allVisibleSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
              </Text>
            </Pressable>
          }
          ListEmptyComponent={<Text style={styles.empty}>Aucun résultat pour « {query} ».</Text>}
          renderItem={({ item }) => {
            const on = selected.has(item.key);
            return (
              <Pressable
                onPress={() => toggle(item.key)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={item.title}
              >
                <View style={[styles.checkbox, on && styles.checkboxOn]}>
                  {on && <Icon name="check" size={16} color={colors.onAccent} />}
                </View>
                <TrackCover
                  uri={item.artworkUri}
                  size={44}
                  fallbackIcon="album"
                  seed={`${item.title}${item.artist}`}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {item.artist} · {item.trackCount} titre{item.trackCount > 1 ? 's' : ''}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          onPress={confirmRun}
          disabled={selected.size === 0 || writing}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
            (selected.size === 0 || writing) && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={buttonLabel}
        >
          {writing ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Icon name="link_off" size={20} color={colors.onAccent} />
          )}
          <Text style={styles.primaryLabel}>{buttonLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
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
  rowMeta: {
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
