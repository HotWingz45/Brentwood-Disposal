const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Injects GMSServices.provideAPIKey() into AppDelegate.swift so Google Maps
 * is initialized before any NavigationView mounts.
 *
 * Why: GoogleNavigation v10 requires an explicit provideAPIKey: call at startup.
 * It does NOT auto-read GMSApiKey from Info.plist (unlike the standalone Maps SDK).
 * This must run before RCTReactNativeFactory.startReactNative so the native map
 * view never creates a GMSMapView before the SDK is initialized.
 *
 * The API key is read from Info.plist at runtime so it stays in one source of truth.
 */
const withGoogleMapsInit = (config) => {
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const appDelegatePath = path.join(
        c.modRequest.platformProjectRoot,
        c.modRequest.projectName,
        'AppDelegate.swift'
      );

      if (!fs.existsSync(appDelegatePath)) {
        console.warn('[withGoogleMapsInit] AppDelegate.swift not found at', appDelegatePath);
        return c;
      }

      let content = fs.readFileSync(appDelegatePath, 'utf8');

      if (content.includes('GMSServices.provideAPIKey')) {
        return c; // already patched
      }

      // 1. Add GoogleMaps import after the existing Expo import line
      if (!content.includes('import GoogleMaps')) {
        content = content.replace(
          'import Expo\n',
          'import Expo\nimport GoogleMaps\n'
        );
      }

      // 2. Inject provideAPIKey call right before the #if os(iOS) block that
      //    creates the window and calls startReactNative.
      const anchor = '#if os(iOS) || os(tvOS)\n    window = UIWindow';
      const injection = [
        '// Initialize Google Maps SDK before any map view mounts',
        'if let gmsKey = Bundle.main.object(forInfoDictionaryKey: "GMSApiKey") as? String, !gmsKey.isEmpty {',
        '  GMSServices.provideAPIKey(gmsKey)',
        '}',
        '',
      ]
        .map((line) => (line ? '    ' + line : ''))
        .join('\n');

      if (!content.includes(anchor)) {
        console.warn('[withGoogleMapsInit] Could not find anchor in AppDelegate.swift. Skipping injection.');
        return c;
      }

      content = content.replace(anchor, injection + anchor);
      fs.writeFileSync(appDelegatePath, content);
      console.log('[withGoogleMapsInit] Injected GMSServices.provideAPIKey into AppDelegate.swift');

      return c;
    },
  ]);
};

module.exports = withGoogleMapsInit;
