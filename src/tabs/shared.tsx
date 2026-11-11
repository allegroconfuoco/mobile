import { type ReactNode } from 'react';
import { ActivityIndicator, Linking, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useRouter } from '@/lib/useRouter';
import { useLibrary } from '@/library/LibraryProvider';

/**
 * Briques communes aux quatre onglets : en-tête, états vides, pull-to-refresh.
 */

/** Libellé « N titre(s) » / « N album(s) ». */
export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count > 1 ? 's' : ''}`;
}

/**
 * En-tête d'un onglet : grand titre, sous-titre, et à droite les deux accès transverses — la
 * **recherche globale** (titres, artistes, albums, playlists) et les **réglages**. Ils sont au même
 * endroit sur les quatre onglets, donc toujours à un tap.
 */
export function TabHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Contenu sous le titre (sélecteur, barre de tri). */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={{ paddingTop: insets.top + spacing.md }}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <HeaderButton icon="search" label="Rechercher" onPress={() => router.push('/search')} />
        <HeaderButton icon="settings" label="Réglages" onPress={() => router.push('/settings')} />
      </View>
      {children}
    </View>
  );
}

/** Bouton icône d'en-tête, cible tactile de 44 px. */
export function HeaderButton({
  icon,
  label,
  onPress,
  color = colors.textPrimary,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={4}
      style={styles.headerButton}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={26} color={color} />
    </PressableScale>
  );
}

/** `RefreshControl` aux couleurs de l'app (pull-to-refresh). */
export function themedRefresh(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surface}
    />
  );
}

/** Message centré avec icône et action optionnelle (états vides, permission, erreur). */
export function StateMessage({
  icon,
  text,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.centered}>
      <Icon name={icon} size={40} color={colors.textMuted} />
      <Text style={styles.stateText}>{text}</Text>
      {actionLabel && onAction && (
        <PressableScale
          onPress={onAction}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.buttonLabel}>{actionLabel}</Text>
        </PressableScale>
      )}
    </View>
  );
}

/**
 * Ce qu'un onglet de bibliothèque affiche quand il n'y a pas (encore) de musique : chargement,
 * permission à accorder, bibliothèque vide, erreur de scan. Renvoie `null` quand la bibliothèque
 * est prête et non vide — l'onglet rend alors son contenu.
 */
export function LibraryGate(): ReactNode {
  const { status, error, tracks, requestPermission, rescan } = useLibrary();

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
          onAction={requestPermission}
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
          <StateMessage icon="refresh" text={error} actionLabel="Réessayer" onAction={rescan} />
        );
      }
      if (tracks.length === 0) {
        return (
          <StateMessage
            icon="library_music"
            text="Aucun fichier audio trouvé sur l'appareil."
            actionLabel="Relancer le scan"
            onAction={rescan}
          />
        );
      }
      return null;
  }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.xxl,
    paddingRight: spacing.md,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typography.display,
  },
  subtitle: {
    ...typography.label,
    marginTop: spacing.xs,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
});
