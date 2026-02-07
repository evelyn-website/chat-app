// Global test configuration

// Note: @testing-library/react-native v12.4+ includes built-in Jest matchers
// Matchers are automatically available when importing from @testing-library/react-native in tests

// Silence console output during tests to reduce noise
// This suppresses expected error/warn/log messages from service code
global.console = {
  ...console,
  // Keep info for debugging if needed
  info: console.info,
  // Suppress noisy logs during tests
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
  // Keep debug and trace if needed
  debug: console.debug,
  trace: console.trace,
};

// Mock react-native-get-random-values (required for uuid)
jest.mock('react-native-get-random-values', () => ({
  getRandomValues: jest.fn((arr) => {
    // Fill with pseudo-random values for testing
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }),
}));

// Mock @react-native-community/netinfo (native module used by WebSocketContext)
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
}));

// Set up global test timeout
jest.setTimeout(10000);
