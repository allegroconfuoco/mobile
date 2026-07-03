import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import type { Track } from 'react-native-track-player';

import { colors, coverFallback, radii, spacing, typography } from '@/theme';
import { Icon } from '@/components/Icon';
import { usePlayer, useQueue } from '@/player/PlayerProvider';

/**
 * Écran File d'attente, présenté en modal.
 *
 * Visualise la file courante (snapshot réactif `useQueue`), avec la piste en cours mise en
 * avant. Chaque ligne permet de sauter à la piste (tap), de la monter/descendre (réordonner)
 * et de la retirer. Les mutations passent par le lecteur via `usePlayer`.
 */
export default function QueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tracks, activeIndex } = useQueue();
  const { skipToIndex, moveInQueue, removeFromQueue } = usePlayer();

  const count = tracks.length;
  const subtitle = count === 0 ? 'File vide' : `${count} ${count > 1 ? 'titres' : 'titre'} en file`;

  return (
    <View
      style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom }]}
    >
      {/* Barre supérieure : fermer + titre */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Fermer la file d'attente"
        >
          <Icon name="expand_more" size={28} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.topText}>
          <Text style={styles.title}>File d&apos;attente</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {/* Espace symétrique au chevron pour centrer le titre. */}
        <View style={styles.topSpacer} />
      </View>

      {count === 0 ? (
        <View style={styles.centered}>
          <Icon name="queue_music" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Aucune piste dans la file.</Text>
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(track, index) => `${track.id ?? 'track'}-${index}`}
          renderItem={({ item, index }) => (
            <QueueRow
              track={item}
              index={index}
              isActive={index === activeIndex}
              isFirst={index === 0}
              isLast={index === count - 1}
              onPlay={() => void skipToIndex(index)}
              onMoveUp={() => void moveInQueue(index, index - 1)}
              onMoveDown={() => void moveInQueue(index, index + 1)}
              onRemove={() => void removeFromQueue(index)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

type QueueRowProps = {
  track: Track;
  index: number;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPlay: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

function QueueRow({
  track,
  isActive,
  isFirst,
  isLast,
  onPlay,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QueueRowProps) {
  const title = track.title ?? 'Titre inconnu';
  const artist = track.artist ?? 'Artiste inconnu';
  const artwork = typeof track.artwork === 'string' ? track.artwork : null;

  return (
    <View style={[styles.row, isActive && styles.rowActive]}>
      <Pressable
        onPress={onPlay}
        style={styles.rowMain}
        accessibilityRole="button"
        accessibilityState={isActive ? { selected: true } : {}}
        accessibilityLabel={`Lire ${title}`}
      >
        <Cover uri={artwork} />
        <View style={styles.rowText}>
          <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {artist}
          </Text>
        </View>
        {isActive && <Icon name="graphic_eq" size={20} color={colors.accentIcon} />}
      </Pressable>

      {/* Réordonner + retirer */}
      <View style={styles.rowActions}>
        <Pressable
          onPress={onMoveUp}
          disabled={isFirst}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Monter ${title}`}
        >
          <Icon
            name="arrow_upward"
            size={20}
            color={isFirst ? colors.textMuted : colors.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={onMoveDown}
          disabled={isLast}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Descendre ${title}`}
        >
          <Icon
            name="arrow_downward"
            size={20}
            color={isLast ? colors.textMuted : colors.textSecondary}
          />
        </Pressable>
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Retirer ${title} de la file`}
        >
          <Icon name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

/** Pochette de piste : image du tag, ou pastille pleine de repli. */
function Cover({ uri }: { uri: string | null }) {
  if (uri) {
    return <Image source={{ uri }} style={styles.cover} contentFit="cover" accessible={false} />;
  }
  return (
    <View style={[styles.cover, styles.coverFallback]}>
      <Icon name="music_note" size={18} color={colors.onAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  topText: {
    flex: 1,
    alignItems: 'center',
  },
  topSpacer: {
    width: 28,
  },
  title: {
    ...typography.title,
    fontSize: 18,
  },
  subtitle: {
    ...typography.label,
    fontSize: 10,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  emptyText: {
    ...typography.body,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  rowActive: {
    backgroundColor: colors.surface,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minWidth: 0,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: coverFallback,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...typography.heading,
    fontSize: 14,
  },
  rowTitleActive: {
    color: colors.accentIcon,
  },
  rowMeta: {
    ...typography.body,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingLeft: spacing.md,
  },
});
