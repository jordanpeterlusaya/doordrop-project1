const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Prefer Firebase's React Native build (WebChannel) over Node/gRPC entrypoints.
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

module.exports = config;
