import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Href, useRouter } from 'expo-router';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { useLibrary } from '@/library/LibraryProvider';

type Row = { icon: IconName; label: string; hint: string; href?: Href };

/** Onglet Réglages. */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { folders, excludedTracks } = useLibrary();

  const libraryHint = useMemo(() => {
    if (folders.length === 0) {
      return 'Scan à configurer';
    }
    const included = folders.filter((f) => f.included).length;
    const excludedTotal = folders.length - included + excludedTracks.length;
    const base = `${included}/${folders.length} dossiers`;
    return excludedTotal > 0 ? `${base} · ${excludedTotal} exclus` : base;
  }, [folders, excludedTracks.length]);

  const rows: Row[] = [
    { icon: 'cloud_done', label: 'Compte & synchronisation', hint: 'Non connecté' },
    {
      icon: 'library_music',
      label: 'Bibliothèque locale',
      hint: libraryHint,
      href: '/library-settings',
    },
    { icon: 'queue_music', label: 'Lecture', hint: 'Qualité, file d’attente' },
  ];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Réglages</Text>

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
              <Icon name="chevron_right" size={22} color={colors.textMuted} />
            </Pressable>
          ))}
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
});
