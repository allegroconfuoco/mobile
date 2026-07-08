/**
 * Éditeur des tags d'une piste pour la revue avant gravure (write-back ID3).
 *
 * Rend les six champs (titre/artiste/album/album-artist/n° piste/n° disque) + le choix de pochette.
 * Pour chaque champ : trois sources — **Fichier** (tag d'origine), **MusicBrainz** (overlay, désactivé
 * si aucune valeur) et **Perso** (saisie libre). Composant **contrôlé** : tout l'état vit dans la
 * `TrackReview` du parent (`writeReview`, pur), qui le remplace via `onChange`. Réutilisé tel quel en
 * mode 1 piste comme dans chaque carte du mode lot.
 */
import { memo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fontFamily, radii, spacing } from '@/theme';
import {
  ALL_FIELDS,
  displayValue,
  hasValue,
  setCover,
  setFieldManual,
  setFieldSource,
  type CoverChoice,
  type FieldKey,
  type TrackReview,
} from '@/library/writeReview';

const LABELS: Record<FieldKey, string> = {
  title: 'Titre',
  artist: 'Artiste',
  album: 'Album',
  albumArtist: "Artiste de l'album",
  trackNo: 'N° piste',
  discNo: 'N° disque',
};

const NUMBER_KEYS = new Set<FieldKey>(['trackNo', 'discNo']);

/** Une pastille de sélection (source d'un champ ou choix de pochette). */
function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
    >
      <Text
        style={[
          styles.chipLabel,
          active && styles.chipLabelActive,
          disabled && styles.chipLabelDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Une ligne de champ : label + sélecteur de source + saisie. */
function FieldRow({
  review,
  fieldKey,
  onChange,
}: {
  review: TrackReview;
  fieldKey: FieldKey;
  onChange: (r: TrackReview) => void;
}) {
  const state = review.fields[fieldKey];
  const mbAvailable = hasValue(review.mb ? review.mb[fieldKey] : null);
  // Valeur affichée : la saisie perso, sinon la valeur de la source active (fichier/MB).
  const value = state.source === 'manual' ? state.manual : displayValue(review, fieldKey);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{LABELS[fieldKey]}</Text>
      <View style={styles.chips}>
        <Chip
          label="Fichier"
          active={state.source === 'file'}
          onPress={() => onChange(setFieldSource(review, fieldKey, 'file'))}
        />
        <Chip
          label="MusicBrainz"
          active={state.source === 'mb'}
          disabled={!mbAvailable}
          onPress={() => onChange(setFieldSource(review, fieldKey, 'mb'))}
        />
        <Chip
          label="Perso"
          active={state.source === 'manual'}
          onPress={() => onChange(setFieldSource(review, fieldKey, 'manual'))}
        />
      </View>
      {/* Éditer bascule automatiquement la source sur « Perso ». */}
      <TextInput
        value={value}
        onChangeText={(text) => onChange(setFieldManual(review, fieldKey, text))}
        keyboardType={NUMBER_KEYS.has(fieldKey) ? 'number-pad' : 'default'}
        placeholder="—"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />
    </View>
  );
}

const COVER_LABELS: Record<CoverChoice, string> = {
  keep: 'Garder',
  remote: 'MusicBrainz',
  none: 'Aucune',
};

/** Éditeur complet d'une piste (contrôlé). */
function TrackTagEditorBase({
  review,
  onChange,
}: {
  review: TrackReview;
  onChange: (r: TrackReview) => void;
}) {
  return (
    <View style={styles.container}>
      {ALL_FIELDS.map((key) => (
        <FieldRow key={key} review={review} fieldKey={key} onChange={onChange} />
      ))}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Pochette</Text>
        <View style={styles.chips}>
          <Chip
            label={COVER_LABELS.keep}
            active={review.cover === 'keep'}
            onPress={() => onChange(setCover(review, 'keep'))}
          />
          <Chip
            label={COVER_LABELS.remote}
            active={review.cover === 'remote'}
            disabled={!review.hasRemoteCover}
            onPress={() => onChange(setCover(review, 'remote'))}
          />
          <Chip
            label={COVER_LABELS.none}
            active={review.cover === 'none'}
            onPress={() => onChange(setCover(review, 'none'))}
          />
        </View>
      </View>
    </View>
  );
}

export const TrackTagEditor = memo(TrackTagEditorBase);

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
    color: colors.textSecondary,
  },
  chipLabelActive: {
    color: colors.onAccent,
  },
  chipLabelDisabled: {
    color: colors.textMuted,
  },
  input: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
});
