/**
 * Fuoco — thème de base (Direction B · « Forge »)
 *
 * Éditorial, à plat, anguleux. Typo Schibsted Grotesk, icônes Material Symbols.
 * Source : fuoco/design/Fuoco.dc.html (bloc « Direction B — Forge »).
 *
 * Tokens uniquement : couleurs, espacements, rayons, typo. Aucun composant ici.
 */

/** Palette « braise » sur fond sombre. */
export const colors = {
  /** Fond des écrans. */
  background: '#141110',
  /** Surface surélevée (mini-player). */
  surface: '#1C1714',
  /** Surface de la barre de navigation. */
  surfaceNav: '#171310',

  /** Accent principal (orange braise). */
  accent: '#FF5A1F',
  /** Accent pour icônes actives / états remplis. */
  accentIcon: '#FF6A2B',
  /** Accent pour labels / eyebrows. */
  accentLabel: '#FF7A45',
  /** Texte posé sur l'accent (boutons pleins). */
  onAccent: '#1A0D07',

  /** Texte principal. */
  textPrimary: '#FAF4EE',
  /** Texte secondaire. */
  textSecondary: '#948578',
  /** Texte discret (numéros, durées, tabs inactifs). */
  textMuted: '#6F635A',

  /** Bordures / séparateurs (sur fond sombre). */
  border: 'rgba(255,255,255,0.08)',
  borderFaint: 'rgba(255,255,255,0.05)',
  borderStrong: 'rgba(255,255,255,0.14)',
} as const;

/**
 * Dégradé de pochette par défaut (placeholder quand pas d'artwork).
 * react-native ne gère pas les gradients CSS : à utiliser avec expo-linear-gradient
 * le jour venu. En attendant, `coverFallback` sert de couleur pleine.
 */
export const coverFallback = '#E0381A';

/** Échelle d'espacement (px). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

/** Rayons — Forge est anguleux (petits rayons). */
export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  pill: 100,
} as const;

/**
 * Familles de polices. Les clés correspondent exactement aux noms exportés par
 * @expo-google-fonts/* et aux clés passées à `useFonts` (voir src/app/_layout.tsx).
 */
export const fontFamily = {
  regular: 'SchibstedGrotesk_400Regular',
  medium: 'SchibstedGrotesk_500Medium',
  semibold: 'SchibstedGrotesk_600SemiBold',
  bold: 'SchibstedGrotesk_700Bold',
  extrabold: 'SchibstedGrotesk_800ExtraBold',
  /** Police d'icônes (ligatures : « home », « search », « settings »…). */
  icons: 'MaterialSymbols_400Regular',
} as const;

/**
 * Styles de texte réutilisables. À étaler dans un style RN :
 *   <Text style={typography.title}>…</Text>
 */
export const typography = {
  /** Grand titre d'écran. */
  display: {
    fontFamily: fontFamily.extrabold,
    fontSize: 30,
    letterSpacing: -0.6,
    color: colors.textPrimary,
  },
  /** Titre de section / d'entité. */
  title: {
    fontFamily: fontFamily.extrabold,
    fontSize: 22,
    letterSpacing: -0.4,
    color: colors.textPrimary,
  },
  /** Titre de ligne (piste, playlist). */
  heading: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  /** Corps de texte. */
  body: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  /** Eyebrow / label en majuscules et espacé. */
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
    color: colors.textSecondary,
  },
  /** Label de tab (barre de navigation). */
  tabLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
} as const;

export const theme = {
  colors,
  spacing,
  radii,
  fontFamily,
  typography,
  coverFallback,
} as const;

export type Theme = typeof theme;

export default theme;
