import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { colors, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { tapLight } from '@/lib/haptics';
import * as db from '@/library/db';
import { isIncognitoEnabled, setIncognitoEnabled } from '@/player/playRecorder';

/**
 * Onglet Écoutes (issue #25) : tableau de bord des statistiques d'écoute + entrée vers
 * l'historique complet et le mode « écoute privée ». Les blocs de stats arrivent au lot 3 ;
 * l'écran porte déjà la navigation et le toggle incognito.
 */
export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [count, setCount] = useState(() => db.countPlayHistory());
  const [incognito, setIncognito] = useState(() => isIncognitoEnabled());

  // Recompte à chaque retour sur l'onglet : les écoutes s'accumulent pendant qu'on navigue.
  useFocusEffect(
    useCallback(() => {
      setCount(db.countPlayHistory());
    }, [])
  );

  const toggleIncognito = (next: boolean) => {
    tapLight();
    setIncognito(next);
    setIncognitoEnabled(next);
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.md }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Écoutes</Text>

        <View style={styles.list}>
          <Pressable
            onPress={() => router.push('/history')}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Ouvrir l'historique d'écoute"
          >
            <Icon name="history" size={24} color={colors.accentIcon} />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Historique</Text>
              <Text style={styles.rowHint}>
                {count > 0
                  ? `${count} écoute${count > 1 ? 's' : ''} enregistrée${count > 1 ? 's' : ''}`
                  : 'Aucune écoute pour l’instant'}
              </Text>
            </View>
            <Icon name="chevron_right" size={22} color={colors.textMuted} />
          </Pressable>

          <View style={styles.row}>
            <Icon
              name="visibility_off"
              size={24}
              color={incognito ? colors.accent : colors.accentIcon}
            />
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Écoute privée</Text>
              <Text style={styles.rowHint}>
                {incognito
                  ? 'Actif — les écoutes ne sont pas enregistrées'
                  : 'Suspend l’enregistrement de l’historique'}
              </Text>
            </View>
            <Switch
              value={incognito}
              onValueChange={toggleIncognito}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor={colors.textPrimary}
            />
          </View>
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
