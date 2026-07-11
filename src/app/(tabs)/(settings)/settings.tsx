import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Href } from 'expo-router';
import { useRouter } from '@/lib/useRouter';

import { colors, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import { tapMedium } from '@/lib/haptics';
import { useAuth } from '@/auth/AuthProvider';
import { useLibrary } from '@/library/LibraryProvider';
import { coverCacheSize } from '@/library/trackTags';
import { useSync } from '@/sync/SyncProvider';

type Row = { icon: IconName; label: string; hint: string; href?: Href };

/** Formate une taille en octets en Ko / Mo lisibles. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} o`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} Ko`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

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
  const { folders, excludedTracks, clearCache } = useLibrary();
  const { signOut } = useAuth();
  const { status, lastSyncedAt, lastSync, syncNow } = useSync();

  // Taille du cache pochettes lue une fois au montage (initialiseur paresseux, pas de re-scan).
  const [cacheSize, setCacheSize] = useState(() => coverCacheSize());
  const [clearing, setClearing] = useState(false);

  const cacheHint = clearing
    ? 'Nettoyage en cours…'
    : cacheSize > 0
      ? `${formatBytes(cacheSize)} de pochettes en cache`
      : 'Pochettes et métadonnées scannées';

  const confirmClearCache = () => {
    Alert.alert(
      'Vider le cache',
      'Supprime les pochettes et les métadonnées mises en cache, puis re-scanne la bibliothèque. Tes playlists, favoris et corrections sont conservés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Vider',
          style: 'destructive',
          onPress: () => {
            tapMedium();
            setClearing(true);
            void clearCache()
              .then((freed) => {
                setCacheSize(0);
                showToast(
                  freed > 0
                    ? `Cache vidé · ${formatBytes(freed)} libérés`
                    : 'Cache vidé, bibliothèque re-scannée',
                  'delete_sweep'
                );
              })
              .catch(() => Alert.alert('Échec', "Le vidage du cache n'a pas abouti."))
              .finally(() => setClearing(false));
          },
        },
      ]
    );
  };

  const libraryHint = useMemo(() => {
    if (folders.length === 0) {
      return 'Scan à configurer';
    }
    const included = folders.filter((f) => f.included).length;
    const excludedTotal = folders.length - included + excludedTracks.length;
    const base = `${included}/${folders.length} dossiers`;
    return excludedTotal > 0 ? `${base} · ${excludedTotal} exclus` : base;
  }, [folders, excludedTracks.length]);

  const offline = lastSync?.result === 'offline';
  const syncHint =
    status === 'syncing'
      ? 'Synchronisation…'
      : status === 'error'
        ? 'Échec — appuie pour réessayer'
        : offline
          ? `Hors-ligne — synchro en attente${lastSyncedAt !== null ? ` · ${formatSyncedAt(lastSyncedAt)}` : ''}`
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
      icon: 'edit_note',
      label: 'Métadonnées & fichiers',
      hint: 'Tags, artistes, albums, nettoyage des titres',
      href: '/file-editing',
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
      {
        text: 'Se déconnecter',
        style: 'destructive',
        onPress: () => {
          tapMedium();
          void signOut();
        },
      },
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
            onPress={() => {
              // Feedback uniquement sur la synchro *manuelle* (les autos restent silencieuses).
              void syncNow().then((result) => {
                if (result === 'ok') {
                  showToast('Playlists synchronisées', 'cloud_done');
                } else if (result === 'offline') {
                  showToast('Hors-ligne — synchro dès que le réseau revient', 'cloud_off');
                } else if (result === 'error') {
                  showToast('Échec de la synchronisation', 'cloud_off');
                }
              });
            }}
            disabled={status === 'syncing'}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Synchroniser les playlists"
            accessibilityState={{ disabled: status === 'syncing', busy: status === 'syncing' }}
          >
            <Icon
              name={status === 'error' || offline ? 'cloud_off' : 'cloud_done'}
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
            onPress={confirmClearCache}
            disabled={clearing}
            style={({ pressed }) => [styles.row, pressed && !clearing ? styles.rowPressed : null]}
            accessibilityRole="button"
            accessibilityLabel="Vider le cache"
            accessibilityState={{ disabled: clearing, busy: clearing }}
          >
            <Icon name="delete_sweep" size={24} color={colors.accentIcon} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Vider le cache</Text>
              <Text style={styles.rowHint}>{cacheHint}</Text>
            </View>
          </Pressable>
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
