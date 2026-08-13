import type { ConfigContext, ExpoConfig } from 'expo/config';

// Variante de build pilotée par la variable d'env APP_VARIANT.
//   APP_VARIANT=development  -> build dev (applicationId .dev, coexiste avec la prod)
//   (rien)                   -> build prod, valeurs de app.json inchangées (CI incluse)
// app.json reste la base (config prod) ; on ne surcharge ici que ce qui doit différer
// pour que les deux applis s'installent en parallèle sur le même téléphone.
const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // slug/name sont requis par ExpoConfig ; le spread les rend optionnels, on les réaffirme.
  slug: config.slug ?? 'fuoco',
  // Nom sous l'icône : distinguer les deux applis d'un coup d'œil.
  name: IS_DEV ? 'Fuoco Dev' : (config.name ?? 'Fuoco'),
  // Scheme distinct : sans ça, les deux applis revendiqueraient le même deep link fuoco://
  // et Android refuserait la seconde installation.
  scheme: IS_DEV ? 'fuoco-dev' : config.scheme,
  ios: {
    ...config.ios,
    // applicationId iOS (hors périmètre mais gardé cohérent).
    bundleIdentifier: IS_DEV ? `${config.ios?.bundleIdentifier}.dev` : config.ios?.bundleIdentifier,
  },
  android: {
    ...config.android,
    // C'EST la clé de la coexistence : deux applicationId = deux applis Android distinctes.
    package: IS_DEV ? `${config.android?.package}.dev` : config.android?.package,
    adaptiveIcon: {
      ...config.android?.adaptiveIcon,
      // Fond d'icône rosé en dev (vs le crème du médaillon en prod) : distingue les deux tuiles
      // sans avoir à générer un second jeu d'assets. Reste clair, pour que le disque du logo
      // continue de se fondre dans son fond au lieu de flotter sur une tuile contrastée.
      backgroundColor: IS_DEV ? '#F7DCD8' : config.android?.adaptiveIcon?.backgroundColor,
    },
  },
});
