/**
 * Mock for expo-secure-store
 * Provides in-memory secure storage for testing
 */

const storage = new Map();

module.exports = {
  getItemAsync: jest.fn((key) => {
    return Promise.resolve(storage.get(key) || null);
  }),

  setItemAsync: jest.fn((key, value) => {
    storage.set(key, String(value));
    return Promise.resolve();
  }),

  deleteItemAsync: jest.fn((key) => {
    storage.delete(key);
    return Promise.resolve();
  }),

  removeItemAsync: jest.fn((key) => {
    storage.delete(key);
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
};
