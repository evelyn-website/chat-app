// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  // Add Jest globals for all mock files and setup files
  {
    files: ["**/__mocks__/**/*.js", "**/jest.setup.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  // Add Node.js globals for react-native-libsodium.js (needs Buffer)
  {
    files: ["**/__mocks__/react-native-libsodium.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
  },
]);
