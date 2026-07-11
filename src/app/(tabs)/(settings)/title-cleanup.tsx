/**
 * Nettoyage de titres par motifs (lot 10 de l'audit) — **grave dans les fichiers**.
 *
 * Cas d'usage : des titres pollués par le téléchargement (« 01 - Artiste - Titre (Official
 * Video) [2019] ») qu'on veut nettoyer en masse, avec des règles personnalisables (tokens
 * `$artiste`, `$()`, `$[]`, `$num`, `$feat` + littéraux — cf. `titleCleanup.ts`, module pur).
 *
 * Flux : règles (presets + saisie libre, persistées dans `app_settings`) → **aperçu obligatoire**
 * avant → après par piste (seules les pistes réellement modifiées apparaissent, cochées par
 * défaut) → « Nettoyer N titres » = gravure ID3 via `graveMany` (backup `track_tag_backup`
 * automatique, arrêt au 1er refus de permission), puis `reloadTracks`.
 *
 * L'entrée de l'aperçu est le **titre fichier actuel** (`loadFileTagsMany` : colonnes `tracks`,
 * tenues à jour à chaque gravure) — PAS la sauvegarde d'origine, sinon les titres déjà nettoyés
 * re-apparaîtraient indéfiniment (bug corrigé). Les artistes **masqués** (`rewriteMasks`, appui
 * long sur une ligne) sont exclus de l'aperçu, avec bascule pour les revoir.
 *
 * Paramètres de route (accès contextuel) : `artist` (pistes de l'artiste) OU `albumArtist`+`album`
 * (pistes de l'album) ; sans paramètre = toute la bibliothèque.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { MaskBar } from '@/components/MaskBar';
import { showToast } from '@/components/Toast';
import { tapMedium } from '@/lib/haptics';
import { SearchBar } from '@/components/SearchBar';
import { useLibrary } from '@/library/LibraryProvider';
import * as db from '@/library/db';
import {
  filterTracks,
  makeAlbumKey,
  sortTracks,
  tracksForAlbum,
  tracksForArtist,
} from '@/library/grouping';
import { isMasked, loadMaskedArtists, maskSet, saveMaskedArtists } from '@/library/rewriteMasks';
import { applyCleanupRules, CLEANUP_PRESETS, DEFAULT_RULES } from '@/library/titleCleanup';
import type { LocalTrack } from '@/library/useAudioLibrary';
import { alertPermissionNeeded, graveMany, type WriteSpec } from '@/library/writeTags';
import { colors, fontFamily, radii, spacing, typography } from '@/theme';

type Params = {
  artist?: string;
  albumArtist?: string;
  album?: string;
  /** Libellé lisible du périmètre, pour le sous-titre. */
  label?: string;
};

const RULES_SETTING = 'cleanup.rules';

function loadRules(): string[] {
  const raw = db.getSetting(RULES_SETTING);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((r) => typeof r === 'string')) {
        return parsed;
      }
    } catch {
      // Valeur corrompue : on repart des règles par défaut.
    }
  }
  return [...DEFAULT_RULES];
}

export default function TitleCleanupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const { tracks, reloadTracks } = useLibrary();

  // Périmètre figé au montage (comme write-tags) : artiste, album, ou bibliothèque entière.
  const [targets] = useState<LocalTrack[]>(() => {
    if (params.artist) {
      return tracksForArtist(tracks, params.artist);
    }
    if (params.album !== undefined) {
      return tracksForAlbum(tracks, makeAlbumKey(params.albumArtist ?? '', params.album ?? ''));
    }
    return sortTracks(tracks, 'title');
  });

  // Règles persistées ; chaque modification est réécrite dans `app_settings`.
  const [rules, setRulesState] = useState<string[]>(loadRules);
  const setRules = (next: string[]) => {
    setRulesState(next);
    db.setSetting(RULES_SETTING, JSON.stringify(next));
  };
  const [customRule, setCustomRule] = useState('');

  const [query, setQuery] = useState('');
  // Pistes décochées par l'utilisateur (la sélection = « modifiées » moins celles-ci) : survivre
  // à un changement de règles qui recalcule l'aperçu.
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(() => new Set());
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState(0);

  // Artistes masqués (« validés ») : leurs pistes sortent de l'aperçu, cf. `rewriteMasks`.
  const [masks, setMasks] = useState<string[]>(loadMaskedArtists);
  const [showMasked, setShowMasked] = useState(false);
  const maskLookup = useMemo(() => maskSet(masks), [masks]);

  // Titres **fichier actuels** (colonnes `tracks`, à jour après chaque gravure) — l'entrée du
  // nettoyage. Surtout pas la sauvegarde d'origine : elle re-proposerait les titres déjà nettoyés.
  const baseTitles = useMemo(() => {
    const base = db.loadFileTagsMany(targets.map((t) => t.id));
    const map = new Map<string, string>();
    for (const t of targets) {
      map.set(t.id, base.get(t.id)?.title ?? t.title);
    }
    return map;
  }, [targets]);

  // Aperçu : seules les pistes dont le titre change apparaissent.
  const changedAll = useMemo(() => {
    const out: { track: LocalTrack; before: string; after: string }[] = [];
    for (const track of targets) {
      const before = baseTitles.get(track.id) ?? track.title;
      const after = applyCleanupRules(before, rules, track.artist);
      if (after !== before) {
        out.push({ track, before, after });
      }
    }
    return out;
  }, [targets, baseTitles, rules]);

  const maskedCount = useMemo(
    () => changedAll.filter((c) => isMasked(maskLookup, c.track.artist)).length,
    [changedAll, maskLookup]
  );
  // La sélection et la gravure dérivent de `changed` : une piste masquée (non affichée) ne peut
  // donc jamais être gravée par inadvertance.
  const changed = useMemo(
    () =>
      showMasked ? changedAll : changedAll.filter((c) => !isMasked(maskLookup, c.track.artist)),
    [changedAll, maskLookup, showMasked]
  );

  const addMask = (name: string | null) => {
    if (!name || isMasked(maskLookup, name)) {
      return;
    }
    const next = [...masks, name];
    setMasks(next);
    saveMaskedArtists(next);
    showToast(`« ${name} » masqué des réécritures`, 'visibility_off');
  };

  const removeMask = (name: string) => {
    const next = masks.filter((m) => m !== name);
    setMasks(next);
    saveMaskedArtists(next);
  };

  const confirmMask = (name: string | null) => {
    if (!name) {
      return;
    }
    Alert.alert(
      'Masquer cet artiste ?',
      `Les titres de « ${name} » seront cachés des écrans de réécriture. Réversible d’un tap sur la puce.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Masquer', onPress: () => addMask(name) },
      ]
    );
  };

  const visible = useMemo(() => {
    const byId = new Map(changed.map((c) => [c.track.id, c]));
    return filterTracks(
      changed.map((c) => c.track),
      query
    ).map((t) => byId.get(t.id)!);
  }, [changed, query]);

  const selectedCount = changed.filter((c) => !deselected.has(c.track.id)).length;
  const canApply = selectedCount > 0 && !writing;

  const toggle = (id: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const addRule = (rule: string) => {
    const trimmed = rule.trim();
    if (trimmed.length === 0 || rules.includes(trimmed)) {
      return;
    }
    setRules([...rules, trimmed]);
  };

  const removeRule = (rule: string) => setRules(rules.filter((r) => r !== rule));

  const run = async () => {
    const items: { track: LocalTrack; spec: WriteSpec }[] = changed
      .filter((c) => !deselected.has(c.track.id))
      .map(({ track, after }) => ({
        track,
        spec: {
          tags: {
            title: after,
            artist: track.artist,
            album: track.album,
            albumArtist: track.albumArtist,
            trackNo: track.trackNo,
            discNo: track.discNo,
          },
          cover: 'keep',
        },
      }));
    if (items.length === 0) {
      return;
    }

    setWriting(true);
    setProgress(0);
    const outcome = await graveMany(items, setProgress);
    setWriting(false);
    reloadTracks();

    if (outcome.permission) {
      alertPermissionNeeded('Relance ensuite le nettoyage.');
      return;
    }
    if (outcome.failed === 0 && outcome.written > 0) {
      showToast(
        `${outcome.written} titre${outcome.written > 1 ? 's' : ''} nettoyé${outcome.written > 1 ? 's' : ''}`,
        'auto_fix_high'
      );
      router.back();
    } else if (outcome.written === 0) {
      Alert.alert('Échec', 'Aucun titre n’a pu être modifié.');
    } else {
      Alert.alert('Nettoyage partiel', `${outcome.written} réussi(s), ${outcome.failed} en échec.`);
    }
  };

  const confirmRun = () => {
    Alert.alert(
      'Nettoyer les titres ?',
      `Le titre nettoyé sera gravé dans ${selectedCount} fichier${selectedCount > 1 ? 's' : ''}. Réversible via la restauration des tags.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Nettoyer',
          style: 'destructive',
          onPress: () => {
            tapMedium();
            void run();
          },
        },
      ]
    );
  };

  const subtitle =
    params.label ??
    (params.artist || params.album !== undefined ? undefined : 'Bibliothèque entière');

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.header}>
          <BackButton onPress={() => router.back()} />
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              Nettoyer les titres
            </Text>
            {subtitle && (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>

        {/* Éditeur de règles : règles actives (retirables) + presets + motif libre. */}
        <View style={styles.rulesBlock}>
          <Text style={styles.rulesLabel}>Motifs à retirer</Text>
          <View style={styles.chips}>
            {rules.map((rule) => (
              <Pressable
                key={rule}
                onPress={() => removeRule(rule)}
                style={styles.chipActive}
                accessibilityRole="button"
                accessibilityLabel={`Retirer la règle ${rule}`}
              >
                <Text style={styles.chipActiveText}>{rule}</Text>
                <Icon name="close" size={14} color={colors.onAccent} />
              </Pressable>
            ))}
            {CLEANUP_PRESETS.filter((p) => !rules.includes(p.rule)).map((p) => (
              <Pressable
                key={p.rule}
                onPress={() => addRule(p.rule)}
                style={styles.chip}
                accessibilityRole="button"
                accessibilityLabel={`Ajouter la règle ${p.label}`}
              >
                <Icon name="add" size={14} color={colors.textSecondary} />
                <Text style={styles.chipText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.customRow}>
            <TextInput
              value={customRule}
              onChangeText={setCustomRule}
              placeholder="Motif libre : $artiste, $(), $[], $num, $feat ou texte"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => {
                addRule(customRule);
                setCustomRule('');
              }}
              returnKeyType="done"
            />
            <Pressable
              onPress={() => {
                addRule(customRule);
                setCustomRule('');
              }}
              disabled={customRule.trim().length === 0}
              style={styles.addButton}
              accessibilityRole="button"
              accessibilityLabel="Ajouter le motif"
            >
              <Icon
                name="add"
                size={22}
                color={customRule.trim().length > 0 ? colors.accentIcon : colors.textMuted}
              />
            </Pressable>
          </View>
          <Text style={styles.hint}>
            L’aperçu porte sur le titre actuel du fichier. Appui long sur une ligne pour masquer son
            artiste (validé) des réécritures.
          </Text>
        </View>

        <SearchBar value={query} onChangeText={setQuery} placeholder="Filtrer les titres" />

        <View style={styles.maskBarWrap}>
          <MaskBar
            masks={masks}
            maskedCount={maskedCount}
            showMasked={showMasked}
            onToggleShow={() => setShowMasked((v) => !v)}
            onRemove={removeMask}
          />
        </View>

        <FlatList
          data={visible}
          keyExtractor={(c) => c.track.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          windowSize={7}
          initialNumToRender={12}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {changed.length === 0
                ? 'Aucun titre modifié par ces motifs.'
                : 'Aucun résultat pour cette recherche.'}
            </Text>
          }
          renderItem={({ item }) => {
            const checked = !deselected.has(item.track.id);
            return (
              <Pressable
                onPress={() => toggle(item.track.id)}
                onLongPress={() => confirmMask(item.track.artist)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={`${item.before}, nettoyé en ${item.after}`}
              >
                <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                  {checked && <Icon name="check" size={16} color={colors.onAccent} />}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.before} numberOfLines={1}>
                    {item.before}
                  </Text>
                  <Text style={styles.after} numberOfLines={1}>
                    → {item.after}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            onPress={confirmRun}
            disabled={!canApply}
            style={[styles.applyButton, !canApply && styles.applyDisabled]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canApply, busy: writing }}
            accessibilityLabel="Nettoyer les titres sélectionnés"
          >
            {writing ? (
              <>
                <ActivityIndicator color={colors.onAccent} size="small" />
                <Text style={styles.applyLabel}>
                  Nettoyage… {progress}/{selectedCount}
                </Text>
              </>
            ) : (
              <Text style={styles.applyLabel}>
                Nettoyer {selectedCount} titre{selectedCount > 1 ? 's' : ''}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  headerText: { flex: 1 },
  title: typography.title,
  subtitle: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rulesBlock: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  rulesLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
  },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  chipActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  chipActiveText: {
    fontFamily: fontFamily.semibold,
    fontSize: 12.5,
    color: colors.onAccent,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  addButton: {
    padding: spacing.xs,
  },
  hint: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  maskBarWrap: {
    paddingHorizontal: spacing.lg,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  empty: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowPressed: { opacity: 0.75 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  rowText: { flex: 1, minWidth: 0 },
  before: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  after: {
    fontFamily: fontFamily.semibold,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: 2,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  applyDisabled: {
    opacity: 0.4,
  },
  applyLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: 15,
    color: colors.onAccent,
  },
});
