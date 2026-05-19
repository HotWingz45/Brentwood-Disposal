const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

/**
 * Patches fmt/base.h via the Podfile post_install hook to disable consteval
 * on all Apple clang versions.
 *
 * Root cause:
 *   fmt/base.h enables consteval when __apple_build_version__ >= 14000029.
 *   Xcode 26 satisfies that check, but this fmt version's consteval usage
 *   is broken on Xcode 26's clang — it calls consteval ctors with runtime
 *   args inside format-inl.h, which clang 17+ rejects.
 *
 * Why not GCC_PREPROCESSOR_DEFINITIONS:
 *   fmt's #define FMT_USE_CONSTEVAL chain is NOT wrapped in #ifndef guards,
 *   so any command-line define gets unconditionally overwritten by the source.
 *
 * Fix:
 *   Change the threshold from 14000029 to 99999999 so ALL Apple clang versions
 *   keep consteval disabled in fmt. This is safe — consteval only enables
 *   compile-time format string checking; disabling it doesn't change runtime.
 */
const withCxxStandard = (config) => {
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const podfilePath = path.join(c.modRequest.platformProjectRoot, 'Podfile');
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      if (podfile.includes('99999999L')) {
        return c; // already injected
      }

      const injection = `
    # Patch fmt/base.h to disable consteval on all Apple clang versions.
    # fmt enables consteval when __apple_build_version__ >= 14000029 (Xcode 14+).
    # Xcode 26 passes that check but consteval is broken in this fmt version —
    # format-inl.h calls consteval ctors with runtime args. Setting the threshold
    # to 99999999 forces FMT_USE_CONSTEVAL=0 regardless of Xcode version.
    fmt_base_h = installer.sandbox.pod_dir('fmt').join('include/fmt/base.h').to_s
    if File.exist?(fmt_base_h)
      content = File.read(fmt_base_h)
      patched = content.gsub('__apple_build_version__ < 14000029L', '__apple_build_version__ < 99999999L')
      if content != patched
        File.write(fmt_base_h, patched)
        puts '[withCxxStandard] Patched fmt/base.h consteval threshold'
      end
    end
`;

      // Inject right after react_native_post_install(...) closing paren
      const anchor = '    )\n';
      const anchorIndex = podfile.indexOf(anchor);
      if (anchorIndex === -1) {
        console.warn('[withCxxStandard] Could not find post_install anchor. Skipping.');
        return c;
      }

      const insertAt = anchorIndex + anchor.length;
      podfile = podfile.slice(0, insertAt) + injection + podfile.slice(insertAt);
      fs.writeFileSync(podfilePath, podfile);

      return c;
    },
  ]);
};

module.exports = withCxxStandard;
