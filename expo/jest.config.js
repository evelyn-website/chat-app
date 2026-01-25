module.exports = {
  preset: 'jest-expo',

  // Setup files run before each test file
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Module name mapper for path aliases
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },

  // Transform ignore patterns - allow Expo modules and react-native modules to be transformed
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-libsodium|react-native-blurhash)',
  ],

  // Test match patterns
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],

  // Collect coverage from these paths
  collectCoverageFrom: [
    'services/**/*.{js,jsx,ts,tsx}',
    'store/**/*.{js,jsx,ts,tsx}',
    'components/context/**/*.{js,jsx,ts,tsx}',
    'hooks/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/__mocks__/**',
  ],

  // Coverage output directory
  coverageDirectory: '<rootDir>/coverage',

  // Coverage thresholds (commented out for now - can be enabled later)
  // coverageThreshold: {
  //   global: {
  //     statements: 70,
  //     branches: 65,
  //     functions: 70,
  //     lines: 70,
  //   },
  // },

  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Test environment
  testEnvironment: 'node',

  // Globals
  globals: {
    'ts-jest': {
      tsconfig: {
        jsx: 'react',
      },
    },
  },

  // Reduce output verbosity
  verbose: false,
  silent: false, // Keep false to see test results, but console logs are suppressed in jest.setup.js
};
