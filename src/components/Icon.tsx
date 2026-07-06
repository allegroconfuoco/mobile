import { Text, type TextStyle } from 'react-native';

import { colors, fontFamily } from '@/theme';

/**
 * Icône Material Symbols rendue via ligature.
 *
 * La police @expo-google-fonts/material-symbols résout le nom de l'icône en glyphe
 * (« home », « search », « library_music », « settings »…), exactement comme le
 * mockup design (`<span style="font-family:'Material Symbols Sharp'">search</span>`).
 *
 * Catalogue des noms : https://fonts.google.com/icons
 */
export type IconName =
  | 'home'
  | 'search'
  | 'library_music'
  | 'settings'
  | 'play_arrow'
  | 'pause'
  | 'skip_next'
  | 'skip_previous'
  | 'shuffle'
  | 'repeat'
  | 'favorite'
  | 'favorite_border'
  | 'cloud_done'
  | 'chevron_right'
  | 'expand_more'
  | 'more_horiz'
  | 'arrow_back'
  | 'queue_music'
  | 'lyrics'
  | 'cast'
  | 'music_note'
  | 'graphic_eq'
  | 'lock'
  | 'refresh'
  | 'arrow_upward'
  | 'arrow_downward'
  | 'drag_indicator'
  | 'playlist_add'
  | 'playlist_play'
  | 'folder'
  | 'block'
  | 'add'
  | 'close'
  | 'sort'
  | 'person'
  | 'album'
  | 'delete'
  | 'edit'
  | 'playlist_add_check'
  | 'check';

type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  style?: TextStyle;
};

export function Icon({ name, size = 24, color = colors.textPrimary, style }: IconProps) {
  return (
    <Text
      // La police d'icônes n'a pas de vrai contenu textuel : on le cache aux lecteurs d'écran.
      accessible={false}
      allowFontScaling={false}
      style={[
        {
          fontFamily: fontFamily.icons,
          fontSize: size,
          lineHeight: size,
          color,
        },
        style,
      ]}
    >
      {name}
    </Text>
  );
}

export default Icon;
