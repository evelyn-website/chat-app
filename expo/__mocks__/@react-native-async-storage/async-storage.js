/**
 * Mock for @react-native-async-storage/async-storage
 * Provides in-memory storage for testing
 */

const storage = new Map();

module.exports = {
  getItem: jest.fn((key) => {
    const value = storage.get(key);
    return Promise.resolve(value || null);
  }),

  setItem: jest.fn((key, value) => {
    storage.set(key, String(value));
    return Promise.resolve();
  }),

  removeItem: jest.fn((key) => {
    storage.delete(key);
    return Promise.resolve();
  }),

  multiGet: jest.fn((keys) => {
    const result = keys.map((key) => [key, storage.get(key) || null]);
    return Promise.resolve(result);
  }),

  multiSet: jest.fn((keyValuePairs) => {
    keyValuePairs.forEach(([key, value]) => {
      storage.set(key, String(value));
    });
    return Promise.resolve();
  }),

  multiRemove: jest.fn((keys) => {
    keys.forEach((key) => {
      storage.delete(key);
    });
    return Promise.resolve();
  }),

  getAllKeys: jest.fn(() => {
    return Promise.resolve(Array.from(storage.keys()));
  }),

  clear: jest.fn(() => {
    storage.clear();
    return Promise.resolve();
  }),

  flushGetRequests: jest.fn(() => {
    return Promise.resolve();
  }),

  // Utility functions for testing
  __getStorage: jest.fn(() => {
    return new Map(storage);
  }),

  __setStorage: jest.fn((newStorage) => {
    storage.clear();
    newStorage.forEach((value, key) => {
      storage.set(key, value);
    });
  }),

  __clear: jest.fn(() => {
    storage.clear();
  }),

  __getAllKeys: jest.fn(() => {
    return Array.from(storage.keys());
  }),

  __getItem: jest.fn((key) => {
    return storage.get(key) || null;
  }),

  __setItem: jest.fn((key, value) => {
    storage.set(key, String(value));
  }),
};
