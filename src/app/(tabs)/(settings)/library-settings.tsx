import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import { tapMedium } from '@/lib/haptics';
import { deleteTracksFromDevice } from '@/library/deleteTrack';
import { useLibrary } from '@/library/LibraryProvider';

/**
 * Réglages > Bibliothèque locale.
 *
 * Choisit les dossiers scannés (blocklist : tout inclus par défaut, les sonneries/notifs sont
 * pré-exclues) et liste les fichiers exclus individuellement, avec réinclusion possible. Partage
 * l'état de `useLibrary` : décocher un dossier ici le retire aussitôt de l'onglet Bibliothèque.
 */
export default function LibrarySettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    folders,
    excludedTracks,
    setFolderIncluded,
    setTrackExcluded,
    setTracksExcluded,
    reloadTracks,
    rescan,
  } = useLibrary();

  const excludedFolders = folders.filter((f) => !f.included).length;

  // Supprime physiquement du téléphone tous les titres exclus individuellement (pas les dossiers).
  // Un seul dialogue de consentement système pour tout le lot (`Asset.delete`). Après suppression
  // on purge les lignes d'exclusion devenues orphelines et on recharge l'affichage.
  const deleteAllExcluded = () => {
    const toDelete = excludedTracks;
    if (toDelete.length === 0) {
      return;
    }
    const n = toDelete.length;
    Alert.alert(
      `Supprimer ${n} titre${n > 1 ? 's' : ''} exclu${n > 1 ? 's' : ''} du téléphone ?`,
      `${n > 1 ? `${n} fichiers seront` : 'Le fichier sera'} définitivement supprimé${n > 1 ? 's' : ''} de l’appareil. Les dossiers exclus ne sont pas concernés.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () =>
            void deleteTracksFromDevice(toDelete).then((deleted) => {
              if (deleted) {
                tapMedium();
                setTracksExcluded(
                  toDelete.map((t) => t.id),
                  false
                );
                reloadTracks();
                showToast(
                  n > 1 ? `${n} fichiers supprimés du téléphone` : 'Fichier supprimé du téléphone',
                  'delete'
                );
              } else {
                showToast('Suppression annulée ou refusée', 'block');
              }
            }),
        },
      ]
    );
  };

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
        <Text style={styles.title}>Bibliothèque locale</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        {/* La gravure de masse (« Écrire dans les fichiers ») a déménagé dans le hub
            Réglages > Métadonnées & fichiers (lot 11). */}

        {/* Dossiers scannés */}
        <Text style={styles.sectionLabel}>Dossiers scannés</Text>
        {folders.length === 0 ? (
          <Text style={styles.empty}>
            Aucun dossier détecté pour l’instant. Lance un scan depuis l’onglet Bibliothèque.
          </Text>
        ) : (
          <View style={styles.list}>
            {folders.map((f) => (
              <View key={f.folder} style={styles.row}>
                <Icon name="folder" size={22} color={colors.accentIcon} />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={styles.rowHint}>
                    {f.count} {f.count > 1 ? 'titres' : 'titre'}
                    {f.included ? '' : ' · exclu'}
                  </Text>
                </View>
                <Switch
                  value={f.included}
                  onValueChange={(v) => setFolderIncluded(f.folder, v)}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.textPrimary}
                  accessibilityLabel={`Scanner le dossier ${f.name}`}
                />
              </View>
            ))}
          </View>
        )}
        {excludedFolders > 0 && (
          <Text style={styles.note}>
            {excludedFolders} dossier{excludedFolders > 1 ? 's' : ''} exclu
            {excludedFolders > 1 ? 's' : ''} du scan.
          </Text>
        )}

        {/* Fichiers exclus individuellement */}
        {excludedTracks.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, styles.sectionSpacer]}>Fichiers exclus</Text>
            <View style={styles.list}>
              {excludedTracks.map((t) => (
                <View key={t.id} style={styles.row}>
                  <Icon name="block" size={22} color={colors.textMuted} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {t.title}
                    </Text>
                    <Text style={styles.rowHint} numberOfLines={1}>
                      {t.filename}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setTrackExcluded(t.id, false)}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={`Réinclure ${t.title}`}
                  >
                    <Icon name="add" size={24} color={colors.accentIcon} />
                  </Pressable>
                </View>
              ))}
            </View>
            {/* Suppression physique de tous les titres exclus (un seul dialogue système). */}
            <Pressable
              onPress={deleteAllExcluded}
              style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
              accessibilityRole="button"
              accessibilityLabel="Supprimer les titres exclus du téléphone"
            >
              <Icon name="delete" size={20} color={colors.danger} />
              <Text style={styles.deleteLabel}>
                Supprimer {excludedTracks.length > 1 ? 'ces titres' : 'ce titre'} du téléphone
              </Text>
            </Pressable>
            <Text style={styles.note}>
              Supprime définitivement les fichiers exclus de l’appareil. Sans effet sur les dossiers
              exclus.
            </Text>
          </>
        )}

        {/* Relancer le scan */}
        <Pressable
          onPress={rescan}
          style={({ pressed }) => [styles.scanButton, pressed && styles.scanButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Relancer le scan"
        >
          <Icon name="refresh" size={20} color={colors.textPrimary} />
          <Text style={styles.scanLabel}>Relancer le scan</Text>
        </Pressable>
      </ScrollView>
    </View>
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
  title: {
    ...typography.title,
    flex: 1,
    minWidth: 0,
  },
  sectionLabel: {
    ...typography.label,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  sectionSpacer: {
    marginTop: spacing.xxl,
  },
  list: {
    paddingHorizontal: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    ...typography.heading,
  },
  rowHint: {
    ...typography.body,
    fontSize: 12,
    marginTop: 2,
  },
  empty: {
    ...typography.body,
    paddingHorizontal: spacing.xxl,
  },
  note: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxl,
    marginHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  scanButtonPressed: {
    backgroundColor: colors.surface,
  },
  scanLabel: {
    ...typography.heading,
    fontSize: 14,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteButtonPressed: {
    backgroundColor: colors.surface,
  },
  deleteLabel: {
    ...typography.heading,
    fontSize: 14,
    color: colors.danger,
  },
});
