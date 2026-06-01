export const isDev        = __DEV__;
export const isProduction = !__DEV__;

/**
 * Controls all debug UI rendering (overlays, chips, log console, diagnostic text).
 * Logging infrastructure itself is never gated — only rendering.
 * Can be temporarily overridden at runtime via the hidden debug gesture.
 */
export const showDebugUI = __DEV__;
