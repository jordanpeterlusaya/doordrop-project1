/* eslint-disable @typescript-eslint/no-require-imports */
const { withAndroidManifest, withGradleProperties } = require('@expo/config-plugins');

/**
 * Strip Expo dev-client deep links and dev-only Gradle flags from release Android builds.
 */
function withStandaloneRelease(config) {
  // Local live-debug builds keep the exp+doordrop launcher scheme.
  if (process.env.DOORDROP_DEV_CLIENT === '1') {
    return config;
  }

  let next = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const application = manifest.manifest?.application?.[0];
    if (!application?.activity) {
      return cfg;
    }

    for (const activity of application.activity) {
      if (!Array.isArray(activity['intent-filter'])) {
        continue;
      }

      activity['intent-filter'] = activity['intent-filter']
        .map((filter) => {
          const dataEntries = filter.data || [];
          if (!dataEntries.length) {
            return filter;
          }

          const kept = dataEntries.filter((entry) => {
            const scheme = entry.$?.['android:scheme'] || '';
            return scheme !== 'exp+doordrop' && !scheme.startsWith('expo-dev');
          });

          if (!kept.length) {
            return null;
          }

          return { ...filter, data: kept };
        })
        .filter(Boolean);
    }

    return cfg;
  });

  next = withGradleProperties(next, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => item.type !== 'property' || item.key !== 'EX_DEV_CLIENT_NETWORK_INSPECTOR'
    );
    cfg.modResults.push({
      type: 'property',
      key: 'EX_DEV_CLIENT_NETWORK_INSPECTOR',
      value: 'false',
    });
    return cfg;
  });

  return next;
}

module.exports = withStandaloneRelease;
