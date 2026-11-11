import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { BottomSheet } from '@/components/BottomSheet';
import { showToast } from '@/components/Toast';
import { tapLight } from '@/lib/haptics';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import * as db from '@/library/db';
import { useFavorites } from '@/library/FavoritesProvider';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';

/**
 * Feuille « Ajouter à », point d'entrée unique pour ranger un ou plusieurs titres : ouverte par le
 * « + » d'une ligne, par le lecteur, ou par le mode sélection.
 *
 * Dans l'ordre : **Nouvelle playlist** (crée puis ajoute dans la foulée), **Favoris** (traité
 * comme une playlist à part, toujours en tête), puis les playlists, la plus récemment modifiée
 * d'abord. Un tap ajoute et referme : c'est le chemin le plus court possible, un tap sur « + »
 * puis un tap sur la destination.
 *
 * Pour un titre seul, la feuille montre où il se trouve déjà (cœur plein, coche) ; retoucher
 * « Favoris » l'en retire, ce qui en fait aussi le bouton pour déliker.
 */
export type PlaylistPickerSheetProps = {
  /** Pistes à ajouter, ou `null` pour garder la feuille fermée. */
  tracks: LocalTrack[] | null;
  onClose: () => void;
  /** Appelé après un ajout réussi (pas sur simple fermeture) — ex. sortir du mode sélection. */
  onAdded?: () => void;
};

export function PlaylistPickerSheet({ tracks, onClose, onAdded }: PlaylistPickerSheetProps) {
  const { playlists, createPlaylist, addTracksToPlaylist } = usePlaylistsContext();
  const { isFavorite, toggleFavorite, addFavorites } = useFavorites();
  const [creating, setCreating] = useState(false);

  const visible = tracks !== null && tracks.length > 0;
  const single = tracks?.length === 1 ? tracks[0] : null;
  const count = tracks?.length ?? 0;

  // Playlists contenant déjà le titre (titre seul uniquement : en lot, la notion n'a pas de sens).
  const containing = useMemo(
    () => new Set(single ? db.loadPlaylistIdsForTrack(single.id) : []),
    [single]
  );
  const singleIsFavorite = single ? isFavorite(single.id) : false;

  const finish = (message: string, icon: IconName) => {
    tapLight();
    showToast(message, icon);
    onAdded?.();
    onClose();
  };

  const onFavorites = () => {
    if (!tracks || tracks.length === 0) {
      return;
    }
    if (single) {
      const liked = toggleFavorite(single.id);
      finish(liked ? 'Ajouté aux favoris' : 'Retiré des favoris', 'favorite');
      return;
    }
    const added = addFavorites(tracks.map((t) => t.id));
    finish(
      added === 0
        ? 'Déjà dans les favoris'
        : added > 1
          ? `${added} titres ajoutés aux favoris`
          : 'Ajouté aux favoris',
      'favorite'
    );
  };

  const addTo = (playlistId: string, playlistName: string) => {
    if (!tracks || tracks.length === 0) {
      return;
    }
    if (single && containing.has(playlistId)) {
      finish(`Déjà dans « ${playlistName} »`, 'playlist_add_check');
      return;
    }
    addTracksToPlaylist(
      playlistId,
      tracks.map((t) => t.id)
    );
    finish(
      count > 1 ? `${count} titres ajoutés à « ${playlistName} »` : `Ajouté à « ${playlistName} »`,
      'playlist_add_check'
    );
  };

  const createAndAdd = (name: string) => {
    const id = createPlaylist(name);
    addTo(id, name);
  };

  return (
    <>
      <BottomSheet
        visible={visible && !creating}
        onClose={onClose}
        title={single ? single.title : `${count} titres`}
      >
        <Row icon="add" label="Nouvelle playlist" accent onPress={() => setCreating(true)} />
        <Row
          icon="favorite"
          iconFilled={single ? singleIsFavorite : true}
          iconColor={colors.accent}
          label="Favoris"
          hint={single && singleIsFavorite ? 'Toucher pour retirer' : undefined}
          checked={singleIsFavorite}
          onPress={onFavorites}
        />

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {playlists.map((p) => (
            <Row
              key={p.id}
              icon="queue_music"
              label={p.name}
              hint={`${p.trackCount} ${p.trackCount > 1 ? 'titres' : 'titre'}`}
              checked={containing.has(p.id)}
              onPress={() => addTo(p.id, p.name)}
            />
          ))}
        </ScrollView>
      </BottomSheet>

      <PlaylistNameDialog
        visible={creating}
        title="Nouvelle playlist"
        submitLabel="Créer"
        onSubmit={createAndAdd}
        onClose={() => setCreating(false)}
      />
    </>
  );
}

function Row({
  icon,
  iconFilled = false,
  iconColor = colors.textSecondary,
  label,
  hint,
  accent = false,
  checked = false,
  onPress,
}: {
  icon: IconName;
  iconFilled?: boolean;
  iconColor?: string;
  label: string;
  hint?: string;
  /** Met la ligne en avant (action de création). */
  accent?: boolean;
  /** Le titre s'y trouve déjà. */
  checked?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.borderStrong }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: checked }}
    >
      <Icon
        name={icon}
        filled={iconFilled}
        size={22}
        color={accent ? colors.accentIcon : iconColor}
      />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, accent && styles.rowLabelAccent]} numberOfLines={1}>
          {label}
        </Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {checked && <Icon name="check" size={20} color={colors.accent} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    // Borne la hauteur : au-delà, la liste des playlists défile dans la feuille.
    maxHeight: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
    borderRadius: radii.sm,
  },
  rowPressed: {
    backgroundColor: colors.background,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    ...typography.heading,
    fontSize: 15,
  },
  rowLabelAccent: {
    color: colors.accentLabel,
  },
  rowHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});

export default PlaylistPickerSheet;
