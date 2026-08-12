// Configuration Metro.
//
// Deux paquets natifs sont Android only (Fuoco l'est, cf. PROJET.md) et leur code est déjà gardé
// par `Platform.OS !== 'web'`, mais leur implémentation web casse `expo export --platform web`
// (notre check de bundle) :
//   - @rntp/player a une vraie impl web mais elle attend `shaka-player` (peer optionnelle,
//     non installée — on ne lit pas de musique sur le web) ;
//   - expo-sqlite importe un module `.wasm` que Metro ne sait pas résoudre.
// On les remplace donc par des stubs web (voir src/player/trackPlayer.web-shim.js et
// src/library/sqlite.web-shim.js) qui ne s'exécutent jamais réellement.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Trois paquets d'animation restent installés sans jamais servir : `react-native-drawer-layout`
// (dépendance d'expo-router) les déclare en peers non optionnelles, donc npm les installe même si
// on n'utilise aucun Drawer — et le projet fait tous ses gestes en `Animated` + `PanResponder` du
// cœur RN (cf. CLAUDE.md). Présents dans node_modules, ils étaient tirés dans le bundle par une
// résolution optionnelle, et surtout **compilés dans l'APK** par l'autolinking : libreanimated.so
// (7,6 Mo) + libworklets.so (4,3 Mo) **par ABI**, pour du code mort.
//
// On les rend donc invisibles à Metro (`blockList`, effet identique à une désinstallation — vérifié
// en renommant les dossiers : le bundle Android se construit sans eux) en miroir de l'exclusion
// d'autolinking déclarée dans `package.json` (`expo.autolinking.exclude`). Les deux doivent rester
// synchronisées : bloquer le JS sans exclure le natif ne gagnerait rien, exclure le natif sans
// bloquer le JS ferait planter reanimated à l'init (il cherche son TurboModule).
const UNUSED_PACKAGES = [
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-gesture-handler',
];
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  ...UNUSED_PACKAGES.map(
    (pkg) => new RegExp(`${path.sep}node_modules${path.sep}${pkg}${path.sep}.*`)
  ),
];

const RNTP_WEB_SHIM = path.resolve(__dirname, 'src/player/trackPlayer.web-shim.js');
const SQLITE_WEB_SHIM = path.resolve(__dirname, 'src/library/sqlite.web-shim.js');

// `expo-symbols` (SF Symbols) est une dépendance d'expo-router qu'on n'utilise nulle part, mais
// son convertisseur d'icônes Android est importé statiquement par `native-tabs` — impossible donc
// de le bloquer. Or il `require()` la police Material Symbols **complète** : 956 Ko d'APK pour des
// glyphes qu'on ne rend jamais (l'appli n'a plus de tabs natives, et ses propres icônes passent
// par notre sous-ensemble de 12 Ko). On redirige donc ses requêtes de police vers ce sous-ensemble.
const ICON_FONT_SUBSET = path.resolve(__dirname, 'assets/fonts/MaterialSymbolsOutlined_Subset.ttf');
// Le fichier est demandé en relatif (`./MaterialSymbols_400Regular.ttf`) depuis un baril du
// paquet : c'est donc le module *demandeur* qui identifie la requête, pas le nom demandé.
const FULL_ICON_FONT_DIR = `${path.sep}@expo-google-fonts${path.sep}material-symbols${path.sep}`;

const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.endsWith('.ttf') &&
    (context.originModulePath ?? '').includes(FULL_ICON_FONT_DIR)
  ) {
    return { type: 'sourceFile', filePath: ICON_FONT_SUBSET };
  }
  if (platform === 'web') {
    if (moduleName === '@rntp/player' || moduleName.startsWith('@rntp/player/')) {
      return { type: 'sourceFile', filePath: RNTP_WEB_SHIM };
    }
    if (moduleName === 'expo-sqlite' || moduleName.startsWith('expo-sqlite/')) {
      return { type: 'sourceFile', filePath: SQLITE_WEB_SHIM };
    }
  }
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  return resolve(context, moduleName, platform);
};

module.exports = config;
