/**
 * Mock for expo-file-system
 * Provides in-memory file system for testing
 */

const fileStorage = new Map();

module.exports = {
  documentDirectory: 'file:///mock/documents/',

  cacheDirectory: 'file:///mock/cache/',

  temporaryDirectory: 'file:///mock/temp/',

  EncodingType: {
    UTF8: 'utf8',
    Base64: 'base64',
  },

  readAsStringAsync: jest.fn((fileUri, options = {}) => {
    const content = fileStorage.get(fileUri);
    if (!content) {
      return Promise.reject(new Error(`File not found: ${fileUri}`));
    }
    return Promise.resolve(content);
  }),

  writeAsStringAsync: jest.fn((fileUri, contents, options = {}) => {
    fileStorage.set(fileUri, contents);
    return Promise.resolve();
  }),

  deleteAsync: jest.fn((fileUri, options = {}) => {
    // Handle idempotent option - if idempotent is true, don't throw if file doesn't exist
    if (options.idempotent && !fileStorage.has(fileUri)) {
      return Promise.resolve();
    }
    if (!fileUri) {
      // Handle undefined/null gracefully (idempotent behavior)
      return Promise.resolve();
    }
    if (!fileStorage.has(fileUri)) {
      return Promise.reject(new Error(`File not found: ${fileUri}`));
    }
    fileStorage.delete(fileUri);
    return Promise.resolve();
  }),

  getInfoAsync: jest.fn((fileUri, options = {}) => {
    const exists = fileStorage.has(fileUri);
    return Promise.resolve({
      exists,
      isDirectory: false,
      modificationTime: Date.now() / 1000,
      size: exists ? fileStorage.get(fileUri).length : 0,
      uri: fileUri,
    });
  }),

  copyAsync: jest.fn((options) => {
    const { from, to } = options;
    const content = fileStorage.get(from);
    if (!content) {
      return Promise.reject(new Error(`Source file not found: ${from}`));
    }
    fileStorage.set(to, content);
    return Promise.resolve();
  }),

  moveAsync: jest.fn((options) => {
    const { from, to } = options;
    const content = fileStorage.get(from);
    if (!content) {
      return Promise.reject(new Error(`Source file not found: ${from}`));
    }
    fileStorage.delete(from);
    fileStorage.set(to, content);
    return Promise.resolve();
  }),

  makeDirectoryAsync: jest.fn((dirUri, options = {}) => {
    // In-memory mock, just track the directory was "created"
    return Promise.resolve();
  }),

  readDirectoryAsync: jest.fn((dirUri) => {
    // Return empty directory listing
    return Promise.resolve([]);
  }),

  // Utility functions for testing
  __getFileStorage: jest.fn(() => {
    return new Map(fileStorage);
  }),

  __setFileStorage: jest.fn((newStorage) => {
    fileStorage.clear();
    newStorage.forEach((content, fileUri) => {
      fileStorage.set(fileUri, content);
    });
  }),

  __clear: jest.fn(() => {
    fileStorage.clear();
  }),

  __setFile: jest.fn((fileUri, content) => {
    fileStorage.set(fileUri, content);
  }),

  __getFile: jest.fn((fileUri) => {
    return fileStorage.get(fileUri) || null;
  }),

  __hasFile: jest.fn((fileUri) => {
    return fileStorage.has(fileUri);
  }),
};
