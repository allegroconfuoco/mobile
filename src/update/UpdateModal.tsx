import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';

export type UpdateModalProps = {
  visible: boolean;
  /** Version minimale non atteinte : pas de fermeture possible, pas de « Plus tard ». */
  forced: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  downloadUrl: string | null;
  onDismiss: () => void;
};

/** Modal de mise à jour — recommandée (annulable) ou forcée (bloquante), cf. `/api/app/version`. */
export function UpdateModal({
  visible,
  forced,
  currentVersion,
  latestVersion,
  downloadUrl,
  onDismiss,
}: UpdateModalProps) {
  const handleDownload = () => {
    if (downloadUrl) {
      Linking.openURL(downloadUrl).catch(() => {});
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={forced ? undefined : onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>
            {forced ? 'Mise à jour requise' : 'Mise à jour disponible'}
          </Text>
          <Text style={styles.title}>
            {forced ? 'Cette version n’est plus supportée' : 'Une nouvelle version de Fuoco est là'}
          </Text>
          <Text style={styles.body}>
            {forced
              ? 'Pour continuer à utiliser Fuoco, installe la dernière version.'
              : 'Tu peux continuer avec cette version, mais on te recommande de mettre à jour.'}
          </Text>
          {currentVersion && latestVersion ? (
            <Text style={styles.versions}>
              Version installée : {currentVersion} · Dernière : {latestVersion}
            </Text>
          ) : null}

          <Pressable
            onPress={handleDownload}
            disabled={!downloadUrl}
            style={[styles.button, !downloadUrl && styles.buttonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Télécharger la mise à jour"
          >
            <Icon name="download" size={18} color={colors.onAccent} />
            <Text style={styles.buttonLabel}>Télécharger l’APK</Text>
          </Pressable>

          {!forced ? (
            <Pressable onPress={onDismiss} style={styles.later} hitSlop={8}>
              <Text style={styles.laterLabel}>Plus tard</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  eyebrow: {
    ...typography.label,
    color: colors.accentLabel,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.title,
    fontSize: 19,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.body,
    marginBottom: spacing.md,
  },
  versions: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.lg,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonLabel: {
    ...typography.heading,
    fontSize: 14,
    color: colors.onAccent,
  },
  later: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  laterLabel: {
    ...typography.body,
    color: colors.textMuted,
  },
});

export default UpdateModal;
