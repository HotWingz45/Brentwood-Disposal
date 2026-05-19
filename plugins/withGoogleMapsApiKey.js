const { withInfoPlist, withAndroidManifest } = require('@expo/config-plugins');

/**
 * Injects GMSApiKey into iOS Info.plist and Google Maps meta-data into AndroidManifest.
 */
const withGoogleMapsApiKey = (config, { apiKey }) => {
  // iOS
  config = withInfoPlist(config, (c) => {
    c.modResults.GMSApiKey = apiKey;
    return c;
  });

  // Android
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application[0];
    if (!app['meta-data']) app['meta-data'] = [];

    // Remove stale entry if re-running prebuild
    app['meta-data'] = app['meta-data'].filter(
      (m) => m.$['android:name'] !== 'com.google.android.geo.API_KEY'
    );

    app['meta-data'].push({
      $: {
        'android:name': 'com.google.android.geo.API_KEY',
        'android:value': apiKey,
      },
    });

    return c;
  });

  return config;
};

module.exports = withGoogleMapsApiKey;
