import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { colors, coverFallback, radii, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { TrackActionsSheet } from '@/components/TrackActionsSheet';
import { type LocalTrack, useAudioLibrary } from '@/library/useAudioLibrary';
import { useTrackTags } from '@/library/useTrackTags';
import { usePlayer } from '@/player/PlayerProvider';
import { usePlayback } from '@/player/usePlayback';

/** Formate une durée (ms) en `m:ss`. */
function formatDuration(ms: number | null): string {
  if (ms == null || ms <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Onglet Bibliothèque : scanne et liste les fichiers audio locaux. */
export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { status, tracks, error, requestPermission, rescan } = useAudioLibrary();

  const subtitle = useMemo(() => {
    if (status === 'ready' && tracks.length > 0) {
      return `${tracks.length} ${tracks.length > 1 ? 'titres' : 'titre'} sur l'appareil`;
    }
    return 'Musique locale';
  }, [status, tracks.length]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      {/* En-tête */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Bibliothèque</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {status === 'ready' && (
          <Pressable
            onPress={rescan}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Relancer le scan"
          >
            <Icon name="refresh" size={26} color={colors.textPrimary} />
          </Pressable>
        )}
      </View>

      <LibraryBody
        status={status}
        tracks={tracks}
        error={error}
        onRequestPermission={requestPermission}
        onRescan={rescan}
      />
    </View>
  );
}

type BodyProps = {
  status: ReturnType<typeof useAudioLibrary>['status'];
  tracks: LocalTrack[];
  error: string | null;
  onRequestPermission: () => void;
  onRescan: () => void;
};

function LibraryBody({ status, tracks, error, onRequestPermission, onRescan }: BodyProps) {
  const { playQueue, playNext, addToQueue } = usePlayer();
  const { track: activeTrack } = usePlayback();
  // Piste dont le menu d'actions (long-press) est ouvert, ou `null` si fermé.
  const [menuTrack, setMenuTrack] = useState<LocalTrack | null>(null);

  switch (status) {
    case 'loading':
    case 'scanning':
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.stateText}>
            {status === 'scanning' ? 'Analyse de la bibliothèque…' : 'Chargement…'}
          </Text>
        </View>
      );

    case 'unsupported':
      return (
        <StateMessage
          icon="library_music"
          text="La bibliothèque locale est disponible depuis l'application Android."
        />
      );

    case 'undetermined':
      return (
        <StateMessage
          icon="library_music"
          text="Fuoco a besoin d'accéder à vos fichiers audio pour construire votre bibliothèque."
          actionLabel="Autoriser l'accès"
          onAction={onRequestPermission}
        />
      );

    case 'denied':
      return (
        <StateMessage
          icon="lock"
          text="L'accès aux fichiers audio est refusé. Activez-le dans les réglages pour scanner votre musique."
          actionLabel="Ouvrir les réglages"
          onAction={() => void Linking.openSettings()}
        />
      );

    case 'ready':
      if (error) {
        return (
          <StateMessage icon="refresh" text={error} actionLabel="Réessayer" onAction={onRescan} />
        );
      }
      if (tracks.length === 0) {
        return (
          <StateMessage
            icon="library_music"
            text="Aucun fichier audio trouvé sur l'appareil."
            actionLabel="Relancer le scan"
            onAction={onRescan}
          />
        );
      }
      return (
        <>
          <FlatList
            data={tracks}
            keyExtractor={(track) => track.id}
            renderItem={({ item, index }) => (
              <TrackRow
                track={item}
                isActive={item.id === activeTrack?.id}
                onPress={() => void playQueue(tracks, index)}
                onLongPress={() => setMenuTrack(item)}
              />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
          <TrackActionsSheet
            title={menuTrack?.title ?? null}
            onClose={() => setMenuTrack(null)}
            onPlayNext={() => menuTrack && void playNext([menuTrack])}
            onAddToQueue={() => menuTrack && void addToQueue([menuTrack])}
          />
        </>
      );
  }
}

type TrackRowProps = {
  track: LocalTrack;
  isActive: boolean;
  onPress: () => void;
  onLongPress: () => void;
};

function TrackRow({ track, isActive, onPress, onLongPress }: TrackRowProps) {
  // Tags ID3 lus paresseusement ; on retombe sur le nom de fichier tant qu'ils manquent.
  const { tags } = useTrackTags(track.id);

  const title = tags?.title ?? track.title;
  const meta = [tags?.artist, tags?.album].filter(Boolean).join(' · ') || 'Artiste inconnu';

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityState={isActive ? { selected: true } : {}}
      accessibilityLabel={`Lire ${title}`}
      accessibilityHint="Appui long pour ajouter à la file"
    >
      <TrackCover uri={tags?.artworkUri ?? null} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {isActive ? (
        <Icon name="graphic_eq" size={20} color={colors.accentIcon} />
      ) : (
        <Text style={styles.rowDuration}>{formatDuration(track.durationMs)}</Text>
      )}
    </Pressable>
  );
}

/** Pochette de piste : image extraite du tag, ou pastille de repli. */
function TrackCover({ uri }: { uri: string | null }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={styles.cover}
        contentFit="cover"
        transition={120}
        accessible={false}
      />
    );
  }
  return (
    <View style={[styles.cover, styles.coverFallback]}>
      <Icon name="music_note" size={20} color={colors.onAccent} />
    </View>
  );
}

type StateMessageProps = {
  icon: IconName;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
};

function StateMessage({ icon, text, actionLabel, onAction }: StateMessageProps) {
  return (
    <View style={styles.centered}>
      <Icon name={icon} size={40} color={colors.textMuted} />
      <Text style={styles.stateText}>{text}</Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.buttonLabel}>{actionLabel}</Text>
        </Pressable>
      )}
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
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.display,
  },
  subtitle: {
    ...typography.label,
    marginTop: spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: 72,
  },
  stateText: {
    ...typography.body,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  buttonLabel: {
    fontFamily: typography.heading.fontFamily,
    fontSize: 14,
    color: colors.onAccent,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  cover: {
    width: 44,
    height: 44,
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
  },
  rowTitle: {
    ...typography.heading,
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
  rowDuration: {
    ...typography.body,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
});
