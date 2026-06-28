const fs = require('fs');
const path = require('path');

const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const NETWORK_SECURITY_CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

module.exports = function withDoorDropAndroidMaps(config, options = {}) {
  const apiKey = options.apiKey || '';

  const withManifest = withAndroidManifest(config, (configWithManifest) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(configWithManifest.modResults);
    const metaData = mainApplication['meta-data'] || [];
    const nextMetaData = metaData.filter((item) => item.$['android:name'] !== 'com.google.android.geo.API_KEY');

    if (apiKey) {
      nextMetaData.push({
        $: {
          'android:name': 'com.google.android.geo.API_KEY',
          'android:value': apiKey,
        },
      });
    }

    mainApplication['meta-data'] = nextMetaData;
    mainApplication.$['android:usesCleartextTraffic'] = 'true';
    mainApplication.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return configWithManifest;
  });

  return withDangerousMod(withManifest, [
    'android',
    async (configWithMod) => {
      const xmlDirectory = path.join(
        configWithMod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml'
      );
      const networkSecurityConfigPath = path.join(xmlDirectory, 'network_security_config.xml');

      fs.mkdirSync(xmlDirectory, { recursive: true });
      fs.writeFileSync(networkSecurityConfigPath, NETWORK_SECURITY_CONFIG_XML);

      return configWithMod;
    },
  ]);
};
