// Configuration Metro.
//
// react-native-track-player n'a de sens que sur natif : Fuoco est Android only (cf. PROJET.md)
// et tout le code lecteur est déjà gardé par `Platform.OS !== 'web'`. Sur le web, la vraie
// implémentation web de RNTP tire `shaka-player` et casse le prerender statique d'Expo. On
// remplace donc le paquet par un stub web (voir src/player/trackPlayer.web-shim.js) pour que
// `expo export --platform web` (notre check de bundle) passe sans dépendance inutile.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const RNTP_WEB_SHIM = path.resolve(__dirname, 'src/player/trackPlayer.web-shim.js');
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    (moduleName === 'react-native-track-player' ||
      moduleName.startsWith('react-native-track-player/'))
  ) {
    return { type: 'sourceFile', filePath: RNTP_WEB_SHIM };
  }
  const resolve = upstreamResolveRequest ?? context.resolveRequest;
  return resolve(context, moduleName, platform);
};

module.exports = config;
