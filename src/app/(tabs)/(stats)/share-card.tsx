import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { colors, radii, spacing, typography } from '@/theme';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { showToast } from '@/components/Toast';
import * as db from '@/library/db';
import { formatDuration } from '@/history/format';
import { periodStartMs, type StatsPeriod } from '@/history/stats';

/**
 * Carte de partage (issue #25, rétrospective) : un visuel vertical résumant la période
 * (temps d'écoute, top artiste, top titre), capturé en PNG via react-native-view-shot puis
 * poussé dans le partage système (stories, messageries). Aucune donnée ne part d'elle-même :
 * c'est une image générée localement, partagée par l'utilisateur.
 */

const PERIOD_LABEL: Record<StatsPeriod, string> = {
  '4w': 'Ces 4 dernières semaines',
  '6m': 'Ces 6 derniers mois',
  all: 'Depuis toujours',
};

function asPeriod(raw: string | undefined): StatsPeriod {
  return raw === '6m' || raw === 'all' ? raw : '4w';
}

export default function ShareCardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ period?: string }>();
  const period = asPeriod(params.period);

  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  // Chargé une fois au montage (initialiseurs paresseux) : la carte est un instantané.
  const [totals] = useState(() => db.playTotals(periodStartMs(period)));
  const [topArtist] = useState(() => db.topArtists(periodStartMs(period), 1)[0] ?? null);
  const [topTrack] = useState(() => db.topTracks(periodStartMs(period), 1)[0] ?? null);

  const share = async () => {
    if (sharing) {
      return;
    }
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        showToast('Partage indisponible sur cet appareil', 'share');
        return;
      }
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: 'Partager mes écoutes',
      });
    } catch {
      showToast('Échec de la capture', 'share');
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <BackButton onPress={() => router.back()} />

      <View style={styles.cardWrap}>
        {/* `collapsable=false` : la vue doit exister nativement pour être capturée. */}
        <View ref={cardRef} collapsable={false} style={styles.card}>
          <Text style={styles.brand}>FUOCO</Text>
          <Text style={styles.periodLabel}>{PERIOD_LABEL[period]}</Text>

          <View style={styles.bigStat}>
            <Text style={styles.bigValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatDuration(totals.playedMs)}
            </Text>
            <Text style={styles.bigLabel}>d’écoute</Text>
          </View>

          {topArtist !== null && (
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Top artiste</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {topArtist.name}
              </Text>
            </View>
          )}
          {topTrack !== null && (
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Top titre</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {topTrack.title ?? 'Titre inconnu'}
              </Text>
            </View>
          )}
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Écoutes</Text>
            <Text style={styles.statValue}>{totals.plays}</Text>
          </View>

          <View style={styles.footerBar} />
        </View>
      </View>

      <Pressable
        onPress={() => void share()}
        disabled={sharing}
        style={({ pressed }) => [styles.shareButton, pressed && styles.shareButtonPressed]}
        accessibilityRole="button"
        accessibilityLabel="Partager la carte"
        accessibilityState={{ disabled: sharing, busy: sharing }}
      >
        <Icon name="share" size={22} color={colors.onAccent} />
        <Text style={styles.shareLabel}>{sharing ? 'Préparation…' : 'Partager'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  cardWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  // Format vertical type story (4:5), palette braise sur charbon — identité Forge.
  card: {
    aspectRatio: 4 / 5,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    justifyContent: 'flex-start',
    gap: spacing.md,
  },
  brand: {
    ...typography.label,
    color: colors.accentLabel,
    letterSpacing: 3,
  },
  periodLabel: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  bigStat: {
    paddingVertical: spacing.xl,
  },
  bigValue: {
    ...typography.display,
    fontSize: 44,
    color: colors.accent,
  },
  bigLabel: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  statRow: {
    borderTopWidth: 1,
    borderTopColor: colors.borderFaint,
    paddingTop: spacing.md,
    gap: 2,
  },
  statLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  statValue: {
    ...typography.heading,
    fontSize: 18,
  },
  footerBar: {
    marginTop: 'auto',
    height: 4,
    width: 56,
    backgroundColor: colors.accent,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.xxl,
    paddingVertical: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  shareButtonPressed: {
    opacity: 0.85,
  },
  shareLabel: {
    ...typography.heading,
    fontSize: 15,
    color: colors.onAccent,
  },
});
