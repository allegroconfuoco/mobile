import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/auth/AuthProvider';
import { useSync } from '@/sync/SyncProvider';

/**
 * Bandeau « hors-ligne » : l'app reste entièrement utilisable sans réseau (bibliothèque, lecture,
 * playlists et favoris vivent en SQLite), on signale juste que ce qui passe par le backend est en
 * attente. Purement informatif — rien n'est bloqué, aucune action proposée : la synchro repart
 * d'elle-même au retour au premier plan.
 *
 * Deux signaux, l'un ou l'autre suffit : `sessionOnline` (le dernier renouvellement de jeton a
 * échoué faute de réseau) et le résultat `offline` de la dernière tentative de synchro.
 */
export function OfflineBanner() {
  const { sessionOnline } = useAuth();
  const { lastSync } = useSync();

  if (sessionOnline && lastSync?.result !== 'offline') {
    return null;
  }

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Icon name="cloud_off" size={18} color={colors.textSecondary} />
      <Text style={styles.text} numberOfLines={2}>
        Hors-ligne · ta musique reste dispo, la synchro reprendra toute seule
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    ...typography.body,
    flex: 1,
    fontSize: 12,
  },
});

export default OfflineBanner;
