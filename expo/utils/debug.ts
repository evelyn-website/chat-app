/**
 * Centralized debug configuration for development logging.
 * All flags default to false - enable specific flags when investigating issues.
 */

// Check if we're in development mode (Expo __DEV__ global)
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export const DEBUG = {
  // Message ordering & rendering
  MESSAGE_FLOW: isDev && false,    // Track message lifecycle from send to display
  MESSAGE_ORDER: isDev && false,   // Detect ordering anomalies

  // Performance
  RENDER_PERF: isDev && false,     // Track render performance
};
