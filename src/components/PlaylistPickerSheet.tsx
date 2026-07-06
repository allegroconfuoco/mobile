import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog';
import { usePlaylistsContext } from '@/library/PlaylistsProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';

/**
 * Feuille basse « Ajouter à une playlist », ouverte depuis le menu long-press d'une piste.
 *
 * Liste les playlists existantes (+ une entrée « Nouvelle playlist » qui ouvre le dialogue de nom).
 * Choisir une playlist y ajoute la piste puis referme. Consomme directement `usePlaylistsContext`
 * pour garder l'écran appelant mince.
 */
export type PlaylistPickerSheetProps = {
  /** Piste à ajouter, ou `null` pour garder la feuille fermée. */
  track: LocalTrack | null;
  onClose: () => void;
};

export function PlaylistPickerSheet({ track, onClose }: PlaylistPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const { playlists, createPlaylist, addTracksToPlaylist } = usePlaylistsContext();
  const [creating, setCreating] = useState(false);

  const visible = track !== null;

  const addTo = (playlistId: string) => {
    if (track) {
      addTracksToPlaylist(playlistId, [track.id]);
    }
    onClose();
  };

  const createAndAdd = (name: string) => {
    const id = createPlaylist(name);
    // La piste est capturée avant fermeture : `addTo` referme aussi la feuille.
    addTo(id);
  };

  return (
    <>
      <Modal
        visible={visible && !creating}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer le menu">
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
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
                  onPress={() => addTo(p.id)}
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
          </Pressable>
        </Pressable>
      </Modal>

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
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
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
