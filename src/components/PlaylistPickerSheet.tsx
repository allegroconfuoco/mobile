import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { BottomSheet } from '@/components/BottomSheet';
import { showToast } from '@/components/Toast';
import { tapLight } from '@/lib/haptics';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';

/**
 * Feuille basse « Ajouter à une playlist », ouverte depuis le menu long-press d'une piste ou le
 * mode sélection de la bibliothèque (multi-titres).
 *
 * Liste les playlists existantes (+ une entrée « Nouvelle playlist » qui ouvre le dialogue de nom).
 * Choisir une playlist y ajoute les pistes puis referme. Consomme directement `usePlaylistsContext`
 * pour garder l'écran appelant mince ; `db.addTracksToPlaylist` est déjà batch (dédup comprise).
 */
export type PlaylistPickerSheetProps = {
  /** Pistes à ajouter, ou `null` pour garder la feuille fermée. */
  tracks: LocalTrack[] | null;
  onClose: () => void;
};

export function PlaylistPickerSheet({ tracks, onClose }: PlaylistPickerSheetProps) {
  const { playlists, createPlaylist, addTracksToPlaylist } = usePlaylistsContext();
  const [creating, setCreating] = useState(false);

  const visible = tracks !== null && tracks.length > 0;

  const addTo = (playlistId: string, playlistName: string) => {
    if (tracks && tracks.length > 0) {
      addTracksToPlaylist(
        playlistId,
        tracks.map((t) => t.id)
      );
      tapLight();
      showToast(
        tracks.length > 1
          ? `${tracks.length} titres ajoutés à « ${playlistName} »`
          : `Ajouté à « ${playlistName} »`,
        'playlist_add_check'
      );
    }
    onClose();
  };

  const createAndAdd = (name: string) => {
    const id = createPlaylist(name);
    // Les pistes sont capturées avant fermeture : `addTo` referme aussi la feuille.
    addTo(id, name);
  };

  return (
    <>
      <BottomSheet visible={visible && !creating} onClose={onClose}>
        <Text style={styles.header} numberOfLines={1}>
          Ajouter à une playlist
        </Text>

        <Pressable
          onPress={() => setCreating(true)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel="Nouvelle playlist"
        >
          <Icon name="add" size={22} color={colors.accentIcon} />
          <Text style={styles.rowLabel}>Nouvelle playlist</Text>
        </Pressable>

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {playlists.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => addTo(p.id, p.name)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Ajouter à ${p.name}`}
            >
              <Icon name="queue_music" size={22} color={colors.textSecondary} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.rowHint}>
                  {p.trackCount} {p.trackCount > 1 ? 'titres' : 'titre'}
                </Text>
              </View>
            </Pressable>
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

const styles = StyleSheet.create({
  header: {
    ...typography.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
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
  rowHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});

export default PlaylistPickerSheet;
