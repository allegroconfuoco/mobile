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

const RNTP_WEB_SHIM = path.resolve(__dirname, 'src/player/trackPlayer.web-shim.js');
const SQLITE_WEB_SHIM = path.resolve(__dirname, 'src/library/sqlite.web-shim.js');
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
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
