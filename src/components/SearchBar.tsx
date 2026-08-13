import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Barre de recherche contrôlée (issue #15), style Forge.
 *
 * Le parent détient la valeur (recherche en temps réel = `onChangeText` à chaque frappe).
 * La croix n'apparaît qu'avec du texte et vide le champ via `onChangeText('')`.
 */
export type SearchBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /**
   * Ouvre le clavier au montage. Sert à l'entrée « Rechercher » de l'accueil, qui doit amener
   * directement au champ actif plutôt qu'à un écran où il reste un tap à faire.
   */
  autoFocus?: boolean;
};

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Rechercher',
  autoFocus = false,
}: SearchBarProps) {
  return (
    <View style={styles.container}>
      <Icon name="search" size={20} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoFocus={autoFocus}
        style={styles.input}
        selectionColor={colors.accent}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        // On gère notre propre croix (cohérence Android/iOS, style Forge).
        clearButtonMode="never"
        accessibilityLabel="Rechercher dans la bibliothèque"
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Effacer la recherche"
        >
          <Icon name="close" size={18} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    // Évite un padding vertical implicite qui déséquilibre la barre sur Android.
    paddingVertical: 0,
  },
});

export default SearchBar;
