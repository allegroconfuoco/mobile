/**
 * Hub **Métadonnées & fichiers** (Réglages, lot 11) — regroupe les outils d'édition des tags qui
 * écrivent directement dans les fichiers (write-back ID3), en lot, plus un état de
 * l'enrichissement MusicBrainz (compteurs par statut).
 *
 * Choix de périmètre acté avec l'utilisateur : ces outils **gravent dans les MP3** (fichiers propres,
 * data-ownership), pas un overlay réversible. La réversibilité passe par la restauration des tags
 * d'origine (sauvegardés à la première gravure, cf. `writeTags`/`track_tag_backup`).
 *
 * Les éditions d'un **seul** titre restent accessibles par appui long sur une piste (corriger les
 * infos, identifier/rattacher un album, écrire les tags, modifier les artistes) : on ne les duplique
 * pas ici, mais les écrans en lot acceptent aussi une sélection d'un seul élément (« singulier »).
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Href } from 'expo-router';
import { useRouter } from '@/lib/useRouter';

import { BackButton } from '@/components/BackButton';
import { Icon, type IconName } from '@/components/Icon';
import * as db from '@/library/db';
import { colors, fontFamily, radii, spacing, typography } from '@/theme';

type Tool = { icon: IconName; label: string; hint: string; href: Href };

const TOOLS: Tool[] = [
  {
    icon: 'save',
    label: 'Écrire les tags de la bibliothèque',
    hint: 'Revue avant gravure, toutes les pistes',
    href: { pathname: '/write-tags', params: { scope: 'library' } },
  },
  {
    icon: 'person_add',
    label: 'Associer un artiste',
    hint: 'Déclarer le même artiste sur plusieurs titres',
    href: '/bulk-set-artist',
  },
  {
    icon: 'auto_fix_high',
    label: 'Associer les artistes inconnus',
    // Seul outil du hub en overlay réversible (pas de gravure) : le préciser dans le hint.
    hint: 'Revue titre par titre via MusicBrainz — overlay réversible, gravure séparée',
    href: '/sort-unknown-artist',
  },
  {
    icon: 'link_off',
    label: 'Dissocier des albums',
    hint: 'Retirer des titres de leur album (vide le tag)',
    href: '/bulk-dissociate-albums',
  },
  {
    icon: 'delete_sweep',
    label: 'Nettoyer les titres',
    hint: 'Retirer parenthèses, n° de piste, préfixe artiste… (motifs personnalisables)',
    href: '/title-cleanup',
  },
];

export default function FileEditingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Compteurs lus une fois au montage (initialiseur paresseux, requête agrégée légère).
  const [stats] = useState<db.EnrichmentStats>(() => db.enrichmentStats());
  const enriched = stats.confirmed + stats.matched;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.title} numberOfLines={1}>
          Métadonnées &amp; fichiers
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Ces outils écrivent les tags directement dans tes fichiers. À la première écriture, les
          tags d’origine sont sauvegardés : tu pourras restaurer une piste.
        </Text>

        {enriched + stats.nomatch + stats.skipped > 0 && (
          <View style={styles.stats}>
            <Icon name="travel_explore" size={18} color={colors.accentLabel} />
            <Text style={styles.statsText}>
              MusicBrainz : {enriched} identifié{enriched > 1 ? 's' : ''}
              {stats.confirmed > 0 ? ` (dont ${stats.confirmed} validés à la main)` : ''} ·{' '}
              {stats.nomatch} sans correspondance
              {stats.skipped > 0 ? ` · ${stats.skipped} ignorés` : ''}
            </Text>
          </View>
        )}

        <View style={styles.list}>
          {TOOLS.map((tool) => (
            <Pressable
              key={tool.label}
              onPress={() => router.push(tool.href)}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Icon name={tool.icon} size={24} color={colors.accentIcon} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{tool.label}</Text>
                <Text style={styles.rowHint}>{tool.hint}</Text>
              </View>
              <Icon name="chevron_right" size={22} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.note}>
          Pour éditer un seul titre (corriger les infos, identifier l’album…), fais un appui long
          sur la piste dans la bibliothèque.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  title: typography.title,
  intro: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
    marginBottom: spacing.lg,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderFaint,
    marginBottom: spacing.lg,
  },
  statsText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    borderColor: colors.borderStrong,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: typography.heading,
  rowHint: {
    ...typography.body,
    fontSize: 12,
    marginTop: 2,
  },
  note: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: spacing.xl,
  },
});
