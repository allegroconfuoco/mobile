import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';

/**
 * Dialogue de saisie du nom d'une playlist (création et renommage).
 *
 * `Alert.prompt` n'existe pas sur Android : on gère notre propre modal avec un `TextInput`.
 * `visible` est piloté par le parent ; on réinitialise le champ à `initialValue` à chaque
 * ouverture. Valider est désactivé tant que le nom est vide (après trim).
 */
export type PlaylistNameDialogProps = {
  visible: boolean;
  /** Titre du dialogue (ex. « Nouvelle playlist », « Renommer »). */
  title: string;
  /** Valeur initiale du champ (nom courant en renommage, vide en création). */
  initialValue?: string;
  /** Libellé du bouton de validation (défaut « Valider »). */
  submitLabel?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
};

export function PlaylistNameDialog({
  visible,
  title,
  initialValue = '',
  submitLabel = 'Valider',
  onSubmit,
  onClose,
}: PlaylistNameDialogProps) {
  const [name, setName] = useState(initialValue);

  // Réamorce le champ à chaque ouverture (le parent réutilise la même instance pour create/rename).
  // Ajustement d'état pendant le rendu (pas d'effet) : on ne réagit qu'à la *transition* fermé→ouvert.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setName(initialValue);
    }
  }

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fermer">
        {/* Empêche la fermeture au tap dans la carte. */}
        <Pressable style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Nom de la playlist"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            autoFocus
            selectionColor={colors.accent}
            returnKeyType="done"
            onSubmitEditing={submit}
            maxLength={80}
            accessibilityLabel="Nom de la playlist"
          />
          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              style={styles.button}
              accessibilityRole="button"
              accessibilityLabel="Annuler"
            >
              <Text style={styles.buttonLabel}>Annuler</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={[styles.button, styles.buttonPrimary, !canSubmit && styles.buttonDisabled]}
              accessibilityRole="button"
              accessibilityLabel={submitLabel}
            >
              <Text style={[styles.buttonLabel, styles.buttonPrimaryLabel]}>{submitLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    fontSize: 18,
  },
  input: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    paddingVertical: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  button: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.sm,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonLabel: {
    ...typography.heading,
    fontSize: 14,
    color: colors.textSecondary,
  },
  buttonPrimaryLabel: {
    color: colors.onAccent,
  },
});

export default PlaylistNameDialog;
