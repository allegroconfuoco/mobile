/**
 * Rangée des **artistes masqués** dans les écrans de réécriture (cf. `library/rewriteMasks`).
 *
 * Chips retirables (un tap = ne plus masquer) + bascule « afficher / re-masquer » quand des lignes
 * de la liste courante correspondent à un masque. Rendu nul sans aucun masque : les écrans
 * l'intègrent sans condition.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import { colors, fontFamily, radii, spacing } from '@/theme';

type Props = {
  /** Noms masqués, tels que persistés (affichés tels quels). */
  masks: readonly string[];
  /** Nb de lignes de la liste courante correspondant à un masque (cachées, ou visibles si `showMasked`). */
  maskedCount: number;
  showMasked: boolean;
  onToggleShow: () => void;
  onRemove: (name: string) => void;
};

export function MaskBar({ masks, maskedCount, showMasked, onToggleShow, onRemove }: Props) {
  if (masks.length === 0) {
    return null;
  }
  return (
    <View style={styles.wrap}>
      {masks.map((name) => (
        <Pressable
          key={name}
          onPress={() => onRemove(name)}
          style={styles.chip}
          accessibilityRole="button"
          accessibilityLabel={`Ne plus masquer ${name}`}
        >
          <Icon name="visibility_off" size={14} color={colors.textSecondary} />
          <Text style={styles.chipText} numberOfLines={1}>
            {name}
          </Text>
          <Icon name="close" size={14} color={colors.textSecondary} />
        </Pressable>
      ))}
      {(maskedCount > 0 || showMasked) && (
        <Pressable
          onPress={onToggleShow}
          style={[styles.chip, showMasked && styles.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: showMasked }}
          accessibilityLabel={
            showMasked ? 'Re-masquer les lignes masquées' : 'Afficher les lignes masquées'
          }
        >
          <Icon
            name={showMasked ? 'visibility' : 'visibility_off'}
            size={14}
            color={showMasked ? colors.onAccent : colors.textSecondary}
          />
          <Text style={[styles.chipText, showMasked && styles.chipTextOn]}>
            {showMasked
              ? 'Re-masquer'
              : `Afficher ${maskedCount} masqué${maskedCount > 1 ? 's' : ''}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    maxWidth: '100%',
  },
  chipOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  chipTextOn: {
    fontFamily: fontFamily.semibold,
    color: colors.onAccent,
  },
});
