const GOOGLE_MAPS_API_KEY          = process.env.GOOGLE_MAPS_API_KEY ?? '';
const SUPABASE_URL                 = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY            = process.env.SUPABASE_ANON_KEY ?? '';
const DOCUMENT_EXTRACTION_URL      = process.env.EXPO_PUBLIC_DOCUMENT_EXTRACTION_URL ?? '';

if (!GOOGLE_MAPS_API_KEY) {
  console.warn('[app.config] GOOGLE_MAPS_API_KEY is not set. Check your .env file.');
}

/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  name: 'BrentwoodDisposal',
  slug: 'brentwood-disposal',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#1a1a2e',
  },
  ios: {
    bundleIdentifier: 'com.brentwooddisposal.driver',
    supportsTablet: false,
    deploymentTarget: '16.0',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'BrentwoodDisposal uses your location for turn-by-turn navigation.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'BrentwoodDisposal uses your location in the background to continue navigation.',
      NSMotionUsageDescription:
        'BrentwoodDisposal uses motion data to improve navigation accuracy.',
      UIBackgroundModes: ['location', 'audio'],
    },
  },
  android: {
    package: 'com.brentwooddisposal.driver',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#1a1a2e',
    },
    minSdkVersion: 24,
  },
  extra: {
    googleMapsApiKey:        GOOGLE_MAPS_API_KEY,
    supabaseUrl:             SUPABASE_URL,
    supabaseAnonKey:         SUPABASE_ANON_KEY,
    documentExtractionUrl:   DOCUMENT_EXTRACTION_URL,
  },
  plugins: [
    'expo-dev-client',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'BrentwoodDisposal uses your location for navigation.',
      },
    ],
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '16.0',
        },
        android: {
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          minSdkVersion: 24,
          enableCoreLibraryDesugaring: true,
        },
      },
    ],
    [
      './plugins/withGoogleMapsApiKey',
      { apiKey: GOOGLE_MAPS_API_KEY },
    ],
    './plugins/withGoogleMapsInit',
    './plugins/withCxxStandard',
  ],
};
