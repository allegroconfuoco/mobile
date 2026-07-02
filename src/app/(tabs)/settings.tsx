import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';

type Row = { icon: IconName; label: string; hint: string };

const ROWS: Row[] = [
  { icon: 'cloud_done', label: 'Compte & synchronisation', hint: 'Non connecté' },
  { icon: 'library_music', label: 'Bibliothèque locale', hint: 'Scan à configurer' },
  { icon: 'queue_music', label: 'Lecture', hint: 'Qualité, file d’attente' },
];

/** Onglet Réglages (placeholder). */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Réglages</Text>

        <View style={styles.list}>
          {ROWS.map((row) => (
            <View key={row.label} style={styles.row}>
              <Icon name={row.icon} size={24} color={colors.accentIcon} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowHint}>{row.hint}</Text>
              </View>
              <Icon name="chevron_right" size={22} color={colors.textMuted} />
            </View>
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
