import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';

const FILTERS = ['Playlists', 'Artistes', 'Albums', 'Titres'] as const;

/** Onglet Bibliothèque (placeholder — le contenu réel arrive avec le scan local). */
export default function LibraryScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        {/* En-tête */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Bibliothèque</Text>
            <Text style={styles.subtitle}>2 134 titres · synchronisé</Text>
          </View>
          <Icon name="search" size={26} color={colors.textPrimary} />
        </View>

        {/* Filtres (segmented, style Forge) */}
        <View style={styles.filters}>
          {FILTERS.map((filter, i) => {
            const active = i === 0;
            return (
              <View key={filter} style={[styles.filter, active && styles.filterActive]}>
                <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>
                  {filter}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Placeholder de contenu */}
        <View style={styles.empty}>
          <Icon name="library_music" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            La bibliothèque locale s&apos;affichera ici.
          </Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.display,
  },
  subtitle: {
    ...typography.label,
    marginTop: spacing.sm,
  },
  filters: {
    flexDirection: 'row',
    gap: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filter: {
    paddingBottom: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  filterActive: {
    borderBottomColor: colors.accent,
  },
  filterLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 14,
    color: colors.textMuted,
  },
  filterLabelActive: {
    color: colors.textPrimary,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: 72,
    paddingHorizontal: spacing.xxl,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
});
