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
  | 'repeat_one'
  | 'favorite'
  | 'favorite_border'
  | 'cloud_done'
  | 'cloud_off'
  | 'sync'
  | 'chevron_right'
  | 'expand_more'
  | 'expand_less'
  | 'music_off'
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
  | 'check'
  | 'check_circle'
  | 'edit_note'
  | 'travel_explore'
  | 'warning'
  | 'restart_alt'
  | 'save'
  | 'settings_backup_restore'
  | 'logout';

type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  /**
   * Rend la variante **pleine** (FILL=1) du glyphe via une seconde police (cf.
   * `theme.fontFamily.iconsFilled`). La police par défaut est FILL=0 (contour) : `favorite` et
   * `favorite_border` y désignent le MÊME glyphe contour, donc un cœur ne peut jamais paraître
   * plein sans cette variante. Aujourd'hui seul `favorite` est disponible en plein.
   */
  filled?: boolean;
  style?: TextStyle;
};

export function Icon({
  name,
  size = 24,
  color = colors.textPrimary,
  filled = false,
  style,
}: IconProps) {
  return (
    <Text
      // Remontage du <Text> quand le glyphe visible change (nom OU variante pleine). Les Material
      // Symbols sont rendus par ligature ; sur certaines versions RN, recycler la vue texte native
      // sans la remonter laisse la ligature figée. La clé garantit un re-façonnage propre.
      key={`${name}${filled ? '-fill' : ''}`}
      // La police d'icônes n'a pas de vrai contenu textuel : on le cache aux lecteurs d'écran.
      accessible={false}
      allowFontScaling={false}
      style={[
        {
          fontFamily: filled ? fontFamily.iconsFilled : fontFamily.icons,
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
