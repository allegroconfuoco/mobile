import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Href, useRouter } from 'expo-router';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { useAuth } from '@/auth/AuthProvider';
import { useLibrary } from '@/library/LibraryProvider';
import { useSync } from '@/sync/SyncProvider';

type Row = { icon: IconName; label: string; hint: string; href?: Href };

/** Heure « à HH:MM » du dernier sync (jour même) ; sinon date courte. */
function formatSyncedAt(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay ? `Synchronisé à ${time}` : `Synchronisé le ${date.toLocaleDateString('fr-FR')}`;
}

/** Onglet Réglages. */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { folders, excludedTracks } = useLibrary();
  const { signOut } = useAuth();
  const { status, lastSyncedAt, syncNow } = useSync();

  const libraryHint = useMemo(() => {
    if (folders.length === 0) {
      return 'Scan à configurer';
    }
    const included = folders.filter((f) => f.included).length;
    const excludedTotal = folders.length - included + excludedTracks.length;
    const base = `${included}/${folders.length} dossiers`;
    return excludedTotal > 0 ? `${base} · ${excludedTotal} exclus` : base;
  }, [folders, excludedTracks.length]);

  const syncHint =
    status === 'syncing'
      ? 'Synchronisation…'
      : status === 'error'
        ? 'Échec — appuie pour réessayer'
        : lastSyncedAt !== null
          ? formatSyncedAt(lastSyncedAt)
          : 'Appuie pour synchroniser';

  const rows: Row[] = [
    {
      icon: 'library_music',
      label: 'Bibliothèque locale',
      hint: libraryHint,
      href: '/library-settings',
    },
    {
      icon: 'queue_music',
      label: 'Lecture',
      hint: 'Répétition, lecture aléatoire',
      href: '/playback-settings',
    },
  ];

  const confirmSignOut = () => {
    Alert.alert('Se déconnecter', 'Tu devras te reconnecter pour synchroniser tes playlists.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Réglages</Text>

        <View style={styles.list}>
          <Pressable
            onPress={() => void syncNow()}
            disabled={status === 'syncing'}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Synchroniser les playlists"
            accessibilityState={{ disabled: status === 'syncing', busy: status === 'syncing' }}
          >
            <Icon
              name={status === 'error' ? 'cloud_off' : 'cloud_done'}
              size={24}
              color={status === 'error' ? colors.accent : colors.accentIcon}
            />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Compte &amp; synchronisation</Text>
              <Text style={styles.rowHint}>{syncHint}</Text>
            </View>
            <Icon name="sync" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.list}>
          {rows.map((row) => (
            <Pressable
              key={row.label}
              onPress={row.href ? () => router.push(row.href!) : undefined}
              disabled={!row.href}
              style={({ pressed }) => [styles.row, pressed && row.href ? styles.rowPressed : null]}
              accessibilityRole={row.href ? 'button' : undefined}
              accessibilityLabel={row.href ? row.label : undefined}
            >
              <Icon name={row.icon} size={24} color={colors.accentIcon} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowHint}>{row.hint}</Text>
              </View>
              {row.href && <Icon name="chevron_right" size={22} color={colors.textMuted} />}
            </Pressable>
          ))}
        </View>

        <View style={styles.list}>
          <Pressable
            onPress={confirmSignOut}
            style={({ pressed }) => [styles.signOut, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Se déconnecter"
          >
            <Icon name="logout" size={22} color={colors.accent} />
            <Text style={styles.signOutLabel}>Se déconnecter</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.display,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  list: {
    paddingHorizontal: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderFaint,
  },
  rowPressed: {
    backgroundColor: colors.surface,
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
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxl,
    paddingVertical: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  signOutLabel: {
    ...typography.heading,
    fontSize: 14,
    color: colors.accent,
  },
});
