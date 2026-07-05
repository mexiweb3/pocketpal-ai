const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

//const localPackagePaths = ['localpath/code/llama.rn'];

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */

const defaultConfig = getDefaultConfig(__dirname);
const {assetExts, sourceExts} = defaultConfig.resolver;

// whisper.rn 0.6.0 declara `exports: {"./*": "./lib/module/*"}` sin extension.
// Metro (package-exports estricto tipo Node ESM) mapea
// `whisper.rn/realtime-transcription` -> `lib/module/realtime-transcription`
// (un directorio, sin `.js`) y NO hace resolucion de indice de directorio, asi
// que el bundle no lo encuentra. Apuntamos el subpath directo al index.js
// construido; sus imports internos son relativos y resuelven en cascada.
const WHISPER_REALTIME = path.resolve(
  __dirname,
  'node_modules/whisper.rn/lib/module/realtime-transcription/index.js',
);

const config = {
  resolver: {
    //nodeModulesPaths: [...localPackagePaths], // update to resolver
    assetExts: assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
    resolveRequest: (context, moduleName, platform) => {
      if (
        moduleName === 'whisper.rn/realtime-transcription' ||
        moduleName === 'whisper.rn/realtime-transcription/index'
      ) {
        return {type: 'sourceFile', filePath: WHISPER_REALTIME};
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  transformer: {
    babelTransformerPath: require.resolve(
      'react-native-svg-transformer/react-native',
    ),
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
    // Make sure decorators are properly transformed
    enableBabelRuntime: true,
  },
  //watchFolders: [...localPackagePaths],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
