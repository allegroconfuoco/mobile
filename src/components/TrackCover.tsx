import { useState } from 'react';
import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';

import { colors, coverFallback, radii } from '@/theme';
import { Icon, type IconName } from '@/components/Icon';

/**
 * Pochette carrée d'une piste / d'un album : image extraite du tag, ou pastille de repli.
 *
 * Mutualisée entre les lignes de bibliothèque, les vignettes d'albums et les en-têtes de
 * détail — d'où la taille et l'icône de repli paramétrables.
 */
type TrackCoverProps = {
  uri: string | null;
  size?: number;
  /** Occupe toute la largeur disponible en carré (vignette d'album) au lieu d'une taille fixe. */
  fill?: boolean;
  /** Icône de repli quand aucune pochette (défaut : note de musique). */
  fallbackIcon?: IconName;
  style?: ViewStyle;
};

export function TrackCover({
  uri,
  size = 44,
  fill = false,
  fallbackIcon = 'music_note',
  style,
}: TrackCoverProps) {
  // Une pochette distante (Cover Art Archive, issue #19) peut renvoyer 404 : on retombe alors sur
  // le repli. On mémorise l'URI en échec pour que le repli disparaisse dès qu'une nouvelle URI
  // arrive (recyclage des lignes de FlatList).
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const box: ViewStyle = fill
    ? { width: '100%', aspectRatio: 1, borderRadius: radii.sm }
    : { width: size, height: size, borderRadius: radii.sm };
  const iconSize = Math.round((fill ? 64 : size) * 0.42);
  if (uri && failedUri !== uri) {
    return (
      <Image
        source={{ uri }}
        // `box`/`style` sont des ViewStyle communs à l'image et au repli ; l'Image attend un
        // ImageStyle (sur-ensemble compatible ici : dimensions + rayon + fond).
        style={[box, styles.image, style] as StyleProp<ImageStyle>}
        contentFit="cover"
        transition={120}
        onError={() => setFailedUri(uri)}
        accessible={false}
      />
    );
  }
  return (
    <View style={[box, styles.fallback, style]}>
      <Icon name={fallbackIcon} size={iconSize} color={colors.onAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surface,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: coverFallback,
  },
});

export default TrackCover;
