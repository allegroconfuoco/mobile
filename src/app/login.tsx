import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/auth';
import { useAuth } from '@/auth/AuthProvider';
import { colors, radii, spacing, typography } from '@/theme';

type Mode = 'signin' | 'signup';

/**
 * Écran de connexion / inscription (porte d'entrée quand la session est absente).
 *
 * Rendu uniquement par le garde `Stack.Protected guard={!isAuthenticated}` de `_layout.tsx` :
 * une connexion réussie fait passer `status` à `authenticated`, ce qui redirige automatiquement
 * vers `(tabs)` (pas de navigation manuelle ici).
 */
export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignup = mode === 'signup';
  const trimmedEmail = email.trim();
  // Le backend impose un mot de passe ≥ 8 caractères (Assert\Length sur User) : on le reflète ici.
  const canSubmit = trimmedEmail.length > 0 && password.length >= 8 && !submitting;

  const toggleMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isSignup) {
        await signUp(trimmedEmail, password, displayName);
      } else {
        await signIn(trimmedEmail, password);
      }
      // Succès : le changement de statut d'auth démonte cet écran, rien à faire de plus.
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : 'Une erreur inattendue est survenue. Réessaie.';
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Fuoco</Text>
          <Text style={styles.title}>{isSignup ? 'Créer un compte' : 'Se connecter'}</Text>
          <Text style={styles.subtitle}>
            {isSignup
              ? 'Ton compte synchronise playlists et lectures entre appareils. Ta musique, elle, reste sur ton téléphone.'
              : 'Connecte-toi pour retrouver tes playlists synchronisées.'}
          </Text>
        </View>

        <View style={styles.form}>
          {isSignup && (
            <Field
              label="Nom affiché (optionnel)"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Ton nom"
              autoCapitalize="words"
              maxLength={255}
            />
          )}
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="toi@exemple.fr"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
          />
          <Field
            label="Mot de passe"
            value={password}
            onChangeText={setPassword}
            placeholder="8 caractères minimum"
            secureTextEntry
            autoCapitalize="none"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
            accessibilityRole="button"
            accessibilityLabel={isSignup ? 'Créer le compte' : 'Se connecter'}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.submitLabel}>
                {isSignup ? 'Créer le compte' : 'Se connecter'}
              </Text>
            )}
          </Pressable>
        </View>

        <Pressable
          onPress={toggleMode}
          disabled={submitting}
          style={styles.switch}
          accessibilityRole="button"
        >
          <Text style={styles.switchText}>
            {isSignup ? 'Déjà un compte ? ' : 'Pas encore de compte ? '}
            <Text style={styles.switchAction}>{isSignup ? 'Se connecter' : 'Créer un compte'}</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Champ de formulaire étiqueté (label + TextInput au style Forge). */
function Field({
  label,
  ...inputProps
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.xxl,
  },
  header: {
    gap: spacing.sm,
  },
  eyebrow: {
    ...typography.label,
    color: colors.accentLabel,
  },
  title: {
    ...typography.display,
  },
  subtitle: {
    ...typography.body,
    lineHeight: 19,
  },
  form: {
    gap: spacing.lg,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  input: {
    ...typography.heading,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  error: {
    ...typography.body,
    color: colors.accent,
  },
  submit: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: spacing.xs,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitLabel: {
    ...typography.heading,
    fontSize: 15,
    color: colors.onAccent,
  },
  switch: {
    alignItems: 'center',
  },
  switchText: {
    ...typography.body,
  },
  switchAction: {
    color: colors.accentLabel,
    fontFamily: typography.heading.fontFamily,
  },
});
