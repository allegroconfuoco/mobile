import { useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import { useRouter } from '@/lib/useRouter';

import { TrackActionsSheet } from '@/components/TrackActionsSheet';
import { PlaylistPickerSheet } from '@/components/PlaylistPickerSheet';
import { showToast } from '@/components/Toast';
import { tapLight, tapMedium } from '@/lib/haptics';
import { useLibrary } from '@/library/LibraryProvider';
import { useFavorites } from '@/library/FavoritesProvider';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { deleteTrackFromDevice } from '@/library/deleteTrack';
import { confirmRestoreTags } from '@/library/writeTags';
import * as db from '@/library/db';
import { usePlayer } from '@/player/PlayerProvider';

/**
 * Menu d'actions long-press mutualisé (bibliothèque, artiste, album, playlist, favoris).
 *
 * Regroupe l'état + le câblage auparavant dupliqués écran par écran : `open(track)` révèle le
 * `TrackActionsSheet`, qui peut à son tour ouvrir le `PlaylistPickerSheet`. L'écran appelant se
 * contente de câbler `onLongPress={open}` sur ses lignes et de rendre `element` dans son arbre.
 *
 * Tous les providers consommés (lecteur, favoris, bibliothèque) sont montés au-dessus des onglets,
 * donc le hook est utilisable depuis n'importe quel écran d'onglet.
 *
 * `onSelect` (optionnel) fait apparaître l'action « Sélectionner » : l'écran appelant entre alors
 * en mode sélection multiple avec la piste du menu pré-cochée (vue Morceaux).
 */
export function useTrackActionsMenu(options?: { onSelect?: (track: LocalTrack) => void }): {
  open: (track: LocalTrack) => void;
  element: ReactNode;
} {
  const onSelect = options?.onSelect;
  const router = useRouter();
  const { setTrackExcluded, reloadTracks } = useLibrary();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { playNext, addToQueue } = usePlayer();

  // Piste dont le menu d'actions est ouvert, ou `null` si fermé.
  const [menuTrack, setMenuTrack] = useState<LocalTrack | null>(null);
  // Piste pour laquelle le sélecteur « Ajouter à une playlist » est ouvert, ou `null`.
  const [pickerTrack, setPickerTrack] = useState<LocalTrack | null>(null);

  const element = (
    <>
      <TrackActionsSheet
        title={menuTrack?.title ?? null}
        isFavorite={menuTrack ? isFavorite(menuTrack.id) : false}
        onClose={() => setMenuTrack(null)}
        onPlayNext={() => {
          if (menuTrack) {
            tapLight();
            void playNext([menuTrack]);
            showToast('Lira ensuite', 'queue_music');
          }
        }}
        onAddToQueue={() => {
          if (menuTrack) {
            tapLight();
            void addToQueue([menuTrack]);
            showToast('Ajouté à la file', 'queue_music');
          }
        }}
        onToggleFavorite={() => {
          if (menuTrack) {
            const wasFavorite = isFavorite(menuTrack.id);
            tapLight();
            toggleFavorite(menuTrack.id, menuTrack.mbid);
            showToast(wasFavorite ? 'Retiré des favoris' : 'Ajouté aux favoris', 'favorite');
          }
        }}
        onAddToPlaylist={() => setPickerTrack(menuTrack)}
        onSelect={onSelect ? () => menuTrack && onSelect(menuTrack) : undefined}
        onFixMetadata={() =>
          menuTrack && router.push({ pathname: '/metadata-fix', params: { trackId: menuTrack.id } })
        }
        onLinkAlbum={() =>
          menuTrack &&
          router.push({ pathname: '/identify-album', params: { trackId: menuTrack.id } })
        }
        onEditArtists={() =>
          menuTrack && router.push({ pathname: '/edit-artists', params: { trackId: menuTrack.id } })
        }
        onWriteToFile={() =>
          menuTrack && router.push({ pathname: '/write-tags', params: { trackId: menuTrack.id } })
        }
        onRestoreFile={() => menuTrack && confirmRestoreTags(menuTrack, reloadTracks)}
        hasFileBackup={menuTrack ? db.hasTagBackup(menuTrack.id) : false}
        onExclude={() => {
          if (menuTrack) {
            setTrackExcluded(menuTrack.id, true);
            showToast('Piste exclue de la bibliothèque', 'block');
          }
        }}
        onDeleteFromDevice={() => {
          if (!menuTrack) {
            return;
          }
          const track = menuTrack;
          Alert.alert(
            'Supprimer du téléphone ?',
            `« ${track.title} » (${track.filename}) sera définitivement supprimé de l’appareil.`,
            [
              { text: 'Annuler', style: 'cancel' },
              {
                text: 'Supprimer',
                style: 'destructive',
                onPress: () =>
                  void deleteTrackFromDevice(track).then((deleted) => {
                    if (deleted) {
                      tapMedium();
                      reloadTracks();
                      showToast('Fichier supprimé du téléphone', 'delete');
                    } else {
                      showToast('Suppression annulée ou refusée', 'block');
                    }
                  }),
              },
            ]
          );
        }}
      />

      <PlaylistPickerSheet
        tracks={pickerTrack ? [pickerTrack] : null}
        onClose={() => setPickerTrack(null)}
      />
    </>
  );

  return { open: setMenuTrack, element };
}
