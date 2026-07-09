/**
 * Écran de **suppression d'artiste(s)** — 1 titre ou tout un album.
 *
 * Cas d'usage : des fichiers du même album ont des artistes hétérogènes (« A » vs « A feat. B » vs
 * « A, B »), ce qui pollue la liste des artistes et — quand le featuring change l'artiste d'album —
 * scinde l'album. Ici on liste les artistes individuels présents sur les pistes visées et on peut en
 * retirer un d'un tap : le champ artiste des pistes concernées est réécrit **sans** cet artiste, via
 * un override réversible (`track_enrichment.artist_override`, ne touche pas le fichier). L'album se
 * re-regroupe alors seul (cf. `albumArtistOf`).
 *
 * Paramètres de route :
 *  - `trackId` : mode 1 titre ;
 *  - `scope=album` (+`albumArtist`+`album`) : mode album (toutes ses pistes).
 *
 * Les pistes sont lues **en direct** depuis la bibliothèque (`tracksById`), donc chaque suppression
 * se reflète immédiatement dans la liste après `reloadTracks`.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import { tapMedium } from '@/lib/haptics';
import { removeArtist, splitArtists } from '@/library/artists';
import * as db from '@/library/db';
import { makeAlbumKey, normalizeForSearch, tracksForAlbum } from '@/library/grouping';
import { useLibrary } from '@/library/LibraryProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { alertPermissionNeeded, graveMany, type WriteSpec } from '@/library/writeTags';
import { colors, fontFamily, radii, spacing, typography } from '@/theme';

type Params = {
  trackId?: string;
  scope?: string;
  albumArtist?: string;
  album?: string;
  /** Libellé lisible (nom d'album), pour le sous-titre. */
  label?: string;
};

/** Un artiste individuel présent sur les pistes visées, avec le nb de pistes où il apparaît. */
type ArtistEntry = { name: string; count: number };

export default function EditArtistsScreen() {
  const params = useLocalSearchParams<Params>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tracks, tracksById, reloadTracks } = useLibrary();

  // Ids des pistes visées, figés au montage (l'album ne « bouge » pas pendant l'édition) ; les
  // valeurs, elles, sont relues en direct depuis `tracksById`.
  const [targetIds] = useState<string[]>(() => {
    if (params.trackId) {
      return [params.trackId];
    }
    if (params.scope === 'album') {
      return tracksForAlbum(tracks, makeAlbumKey(params.albumArtist ?? '', params.album ?? '')).map(
        (t) => t.id
      );
    }
    return [];
  });

  const targetTracks = useMemo(
    () => targetIds.map((id) => tracksById.get(id)).filter((t): t is NonNullable<typeof t> => !!t),
    [targetIds, tracksById]
  );

  // Artistes individuels présents, dédupliqués (casse/accents), triés par occurrence puis nom.
  const artistList = useMemo<ArtistEntry[]>(() => {
    const map = new Map<string, ArtistEntry>();
    for (const t of targetTracks) {
      for (const a of splitArtists(t.artist)) {
        const key = normalizeForSearch(a);
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(key, { name: a, count: 1 });
        }
      }
    }
    return [...map.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
    );
  }, [targetTracks]);

  // Ids ayant un override actif (recalculé quand la biblio change) → révèle « réinitialiser ».
  const overriddenCount = useMemo(
    () => db.loadArtistOverrideIds(targetIds).length,
    // `tracksById` change d'identité à chaque `reloadTracks` : on s'en sert comme signal de
    // rafraîchissement (la valeur n'est pas lue dans le calcul, d'où le disable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetIds, tracksById]
  );

  const isAlbum = params.scope === 'album';
  const subtitle = params.label ?? (isAlbum ? `${targetTracks.length} titres` : null);

  const [writing, setWriting] = useState(false);

  /**
   * Applique la suppression d'un artiste à toutes les pistes visées où il apparaît.
   *
   * Deux modes (lot 9 de l'audit) : `grave=false` = overlay réversible historique
   * (`artist_override`, ne touche pas le fichier) ; `grave=true` = **écrit le tag artiste corrigé
   * dans les MP3** (via `graveMany`, backup `track_tag_backup` automatique) puis purge l'override
   * des pistes écrites (sinon `loadTracks` masquerait le tag frais) — motif de `bulk-set-artist`.
   * Un refus de permission retombe sur l'overlay pour ne pas perdre la correction.
   */
  const applyRemoval = useCallback(
    async (name: string, grave: boolean) => {
      const changes: { track: LocalTrack; next: string }[] = [];
      for (const t of targetTracks) {
        const next = removeArtist(t.artist, name);
        // `null` = retirer viderait le champ (seul artiste) → on ne touche pas cette piste.
        if (next != null && next !== (t.artist ?? '')) {
          changes.push({ track: t, next });
        }
      }
      if (changes.length === 0) {
        return;
      }

      if (!grave) {
        for (const { track, next } of changes) {
          db.setArtistOverride(track.id, next, Date.now());
        }
        reloadTracks();
        showToast(`« ${name} » retiré (réversible)`, 'person_remove');
        return;
      }

      setWriting(true);
      const items: { track: LocalTrack; spec: WriteSpec }[] = changes.map(({ track, next }) => ({
        track,
        spec: {
          tags: {
            title: track.title,
            artist: next,
            album: track.album,
            albumArtist: track.albumArtist,
            trackNo: track.trackNo,
            discNo: track.discNo,
          },
          cover: 'keep',
        },
      }));
      const outcome = await graveMany(items);
      // Le tag est gravé : un override antérieur masquerait la nouvelle valeur → on le retire.
      for (const id of outcome.writtenIds) {
        db.clearArtistOverride(id);
      }
      setWriting(false);

      if (outcome.permission) {
        // Repli : les pistes non écrites reçoivent l'overlay, la correction n'est pas perdue.
        const written = new Set(outcome.writtenIds);
        for (const { track, next } of changes) {
          if (!written.has(track.id)) {
            db.setArtistOverride(track.id, next, Date.now());
          }
        }
        reloadTracks();
        alertPermissionNeeded('En attendant, la correction est posée en overlay réversible.');
        return;
      }
      reloadTracks();
      showToast(
        outcome.failed === 0
          ? `« ${name} » retiré, ${outcome.written} fichier${outcome.written > 1 ? 's' : ''} gravé${outcome.written > 1 ? 's' : ''}`
          : `${outcome.written} gravé(s), ${outcome.failed} en échec`,
        'save'
      );
    },
    [targetTracks, reloadTracks]
  );

  const confirmRemoval = (entry: ArtistEntry) => {
    // Nombre de pistes réellement impactées (celles où le retrait laisse au moins un artiste).
    const affected = targetTracks.filter((t) => {
      const next = removeArtist(t.artist, entry.name);
      return next != null && next !== (t.artist ?? '');
    }).length;
    if (affected === 0) {
      Alert.alert('Rien à retirer', `« ${entry.name} » est le seul artiste des titres concernés.`);
      return;
    }
    Alert.alert(
      'Retirer cet artiste ?',
      `« ${entry.name} » sera retiré de ${affected} titre${affected > 1 ? 's' : ''}. Graver écrit le tag corrigé dans les fichiers (sauvegarde restaurable) — une resynchro ne le perdra pas.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Réversible', onPress: () => void applyRemoval(entry.name, false) },
        {
          text: 'Graver',
          style: 'destructive',
          onPress: () => {
            tapMedium();
            void applyRemoval(entry.name, true);
          },
        },
      ]
    );
  };

  const confirmReset = () => {
    Alert.alert('Réinitialiser les artistes ?', 'Les artistes reviennent aux tags des fichiers.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Réinitialiser',
        style: 'destructive',
        onPress: () => {
          for (const id of targetIds) {
            db.clearArtistOverride(id);
          }
          reloadTracks();
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            Modifier les artistes
          </Text>
          {subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {overriddenCount > 0 && (
          <Pressable
            onPress={confirmReset}
            hitSlop={12}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Réinitialiser les artistes"
          >
            <Icon name="restart_alt" size={22} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {artistList.length === 0 ? (
        <View style={styles.centered}>
          <Icon name="group" size={40} color={colors.textMuted} />
          <Text style={styles.stateText}>Aucun artiste à afficher.</Text>
        </View>
      ) : (
        <FlatList
          data={artistList}
          keyExtractor={(a) => a.name}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.hint}>
              Touche l’icône pour retirer un artiste{isAlbum ? ' de l’album' : ''}. Deux modes :
              réversible (overlay, sans toucher le fichier) ou gravé dans les MP3 (sauvegarde
              restaurable).
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Icon name="person" size={20} color={colors.textSecondary} />
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                {targetTracks.length > 1 && (
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    sur {item.count} titre{item.count > 1 ? 's' : ''}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => confirmRemoval(item)}
                disabled={writing}
                hitSlop={10}
                style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Retirer ${item.name}`}
                accessibilityState={{ disabled: writing, busy: writing }}
              >
                <Icon name="person_remove" size={20} color={colors.accentIcon} />
              </Pressable>
            </View>
          )}
        />
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
  resetButton: {
    padding: spacing.xs,
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
    gap: spacing.sm,
  },
  hint: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1 },
  rowName: {
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
  removeButton: {
    padding: spacing.xs,
  },
  pressed: { opacity: 0.6 },
});
